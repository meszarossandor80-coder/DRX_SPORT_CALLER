const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); // Értékelések biztonságos fájlba mentéséhez

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(__dirname));

const EVAL_FILE = path.join(__dirname, 'evaluations.json'); // Fájl az értékelések megőrzéséhez

const drxFleet = [
    "BMW M4 Competition", "Chevrolet Camaro SS", "Dodge Challenger Hellcat 500LE", 
    "Dodge Challenger Hellcat 700LE", "Ferrari 458 Italia", "Ferrari 488 GTB", 
    "Ferrari F8 Tributo", "Ferrari 458 Challenge Race Taxi", "Ferrari California",  
    "Ford Mustang Shelby GT350", "Ford Mustang 5.0 (automata)", "Ford Mustang 5.0 (manuális)", 
    "Ford Mustang Mach 1", "Ford Mustang Roush", "Shelby AC Cobra", 
    "Lamborghini Gallardo Superleggera", "Lamborghini Huracan", "Mercedes-AMG GT 63 PRO", 
    "Mercedes-AMG GT S", "Mitsubishi Evo IX.", "Mustang Eleanor 67′", 
    "Nissan GT-R 800 LE", "Nissan GT-R 650 LE", "Nissan GT-R 1020 LE", 
    "Porsche 911 GT3", "Porsche 911 GTS", "Porsche 911 Turbo S", 
    "Formula Renault", "Scania R500", "Subaru WRX", "Toyota Yaris GR", 
    "VIP ALLIN FORMULA VEZETÉS", "Trükkös Suzuki"
];

let dailyBookings = {}; 
let currentTrack = "";
let activeInstructors = {}; // Aktív oktatók tárolása (autó -> { név, szelfi })

// Segédfüggvények az értékelések fájlból való betöltéséhez és mentéséhez
function loadEvaluations() {
    try {
        if (fs.existsSync(EVAL_FILE)) {
            const data = fs.readFileSync(EVAL_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("Hiba az értékelések betöltésekor:", err);
    }
    return [];
}

function saveEvaluations(evals) {
    try {
        fs.writeFileSync(EVAL_FILE, JSON.stringify(evals, null, 2), 'utf8');
    } catch (err) {
        console.error("Hiba az értékelések mentésekor:", err);
    }
}

// Inicializáljuk az értékelések listáját a fájlból
let evaluations = loadEvaluations();

drxFleet.forEach(car => { dailyBookings[car] = []; });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/instructor', (req, res) => res.sendFile(path.join(__dirname, 'instructor.html')));

io.on('connection', (socket) => {
    
    // Amikor egy kliens (pl. az Admin) csatlakozik, elküldjük az aktuális értékelési statisztikákat
    socket.emit('update-eval-report', calculateInstructorStats());

    socket.on('admin-upload-list', ({ track, bookings }) => {
        currentTrack = track;
        drxFleet.forEach(car => { dailyBookings[car] = []; });
        
        bookings.forEach(b => {
            if (dailyBookings[b.car]) {
                dailyBookings[b.car].push({
                    code: b.code, name: b.name, time: b.time, car: b.car, laps: b.laps, extras: b.extras, status: "Várakozik", instructor: b.instructor || ""
                });
            }
        });
        io.emit('track-day-opened', currentTrack);
    });

    // MÓDOSÍTVA: Támogatja a régi egyszerű stringes és az új szelfis/neves bejelentkezést is
    socket.on('instructor-connect', (data) => {
        const carName = data.carName || data;
        const instructorName = data.instructorName || "Oktató";
        const selfie = data.selfie || "";

        socket.join(carName);
        
        // Elmentjük a szerver memóriájába, hogy ki vezeti ezt az autót és mi a szelfije
        activeInstructors[carName] = {
            name: instructorName,
            selfie: selfie
        };

        socket.emit('update-instructor-list', dailyBookings[carName] || []);
    });

    socket.on('guest-arrival', (bookingCode) => {
        let found = null;
        let foundCar = "";

        for (let car in dailyBookings) {
            let b = dailyBookings[car].find(x => x.code === bookingCode);
            if (b) { found = b; foundCar = car; break; }
        }

        if (found) {
            if (found.status === "Teljesített ✅") {
                socket.emit('error-message', 'Ezzel a kóddal már lefutották a köröket!');
                return;
            }
            found.status = "Megérkezett (Váróban)";
            found.socketId = socket.id;
            socket.join(foundCar);
            io.to(foundCar).emit('update-instructor-list', dailyBookings[foundCar]);
            socket.emit('guest-arrival-confirmed', found);
        } else {
            socket.emit('error-message', 'A kód nem található a mai listában!');
        }
    });

    // MÓDOSÍTVA: A riasztáskor átküldi a vendégnek az oktató nevét ÉS a fotóját is
    socket.on('call-guest', ({ car, code }) => {
        let b = dailyBookings[car].find(x => x.code === code);
        if (b && b.socketId) {
            b.status = "Behívva (Csörög)";
            
            // Lekérjük a reggel bejelentkezett oktató adatait az autóhoz
            const instructorData = activeInstructors[car] || { name: "Oktatód", selfie: "" };
            b.instructor = instructorData.name; // Elmentjük a vendég adatai közé is

            // Továbbítás a vendég telefonjára
            io.to(b.socketId).emit('you-are-called', { 
                instructor: instructorData.name,
                selfie: instructorData.selfie 
            });

            io.to(car).emit('update-instructor-list', dailyBookings[car]);
        }
    });

    socket.on('guest-acknowledged', (bookingCode) => {
        for (let car in dailyBookings) {
            let b = dailyBookings[car].find(x => x.code === bookingCode);
            if (b) {
                b.status = "Úton van! 🏁";
                io.to(car).emit('update-instructor-list', dailyBookings[car]);
                break;
            }
        }
    });

    // MÓDOSÍTVA: Amikor az instruktor lezárja a futamot, elindítja a vendégnél az értékelést
    socket.on('complete-drive', ({ car, code, instructorName }) => {
        let b = dailyBookings[car].find(x => x.code === code);
        if (b) {
            b.status = "Teljesített ✅";
            
            if (instructorName) b.instructor = instructorName;

            if (b.socketId && io.sockets.sockets.get(b.socketId)) {
                // Aktiváljuk az index.html-en az értékelő ablakot
                io.sockets.sockets.get(b.socketId).emit('drive-finished', { instructor: b.instructor || "Oktatód" });
            }
            io.to(car).emit('update-instructor-list', dailyBookings[car]);
        }
    });

    // ÚJ: Vendég értékelésének fogadása és mentése
    socket.on('submit-evaluation', (data) => {
        evaluations.push({
            bookingCode: data.bookingCode,
            instructor: data.instructor,
            rating: Number(data.rating),
            comment: data.comment,
            timestamp: data.timestamp || new Date()
        });

        saveEvaluations(evaluations); // Biztonságos mentés JSON fájlba

        // Azonnali élő frissítés küldése az admin felületnek
        io.emit('update-eval-report', calculateInstructorStats());
    });

    // ÚJ: Értékelések törlése az admin kérésére
    socket.on('clear-all-evaluations', () => {
        evaluations = [];
        saveEvaluations(evaluations);
        io.emit('update-eval-report', []);
    });
});

// ÚJ: Összesített statisztika számító függvény az admin táblázathoz
function calculateInstructorStats() {
    const stats = {};

    evaluations.forEach(evalData => {
        if (!stats[evalData.instructor]) {
            stats[evalData.instructor] = { totalRating: 0, count: 0, comments: [] };
        }
        stats[evalData.instructor].totalRating += evalData.rating;
        stats[evalData.instructor].count += 1;
        if (evalData.comment && evalData.comment.trim() !== "") {
            stats[evalData.instructor].comments.push(evalData.comment);
        }
    });

    const report = [];
    for (const name in stats) {
        report.push({
            instructor: name,
            average: (stats[name].totalRating / stats[name].count).toFixed(1),
            totalVotes: stats[name].count,
            comments: stats[name].comments
        });
    }
    return report;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DRX Szerver fut a ${PORT}-es porton`));
