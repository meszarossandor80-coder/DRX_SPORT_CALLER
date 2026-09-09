const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(__dirname));

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

drxFleet.forEach(car => { dailyBookings[car] = []; });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/instructor', (req, res) => res.sendFile(path.join(__dirname, 'instructor.html')));

io.on('connection', (socket) => {
    
    socket.on('admin-upload-list', ({ track, bookings }) => {
        currentTrack = track;
        drxFleet.forEach(car => { dailyBookings[car] = []; });
        
        bookings.forEach(b => {
            if (dailyBookings[b.car]) {
                dailyBookings[b.car].push({
                    code: b.code, name: b.name, time: b.time, car: b.car, laps: b.laps, extras: b.extras, status: "Várakozik"
                });
            }
        });
        io.emit('track-day-opened', currentTrack);
    });

    socket.on('instructor-connect', (carName) => {
        socket.join(carName);
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

    socket.on('call-guest', ({ car, code }) => {
        let b = dailyBookings[car].find(x => x.code === code);
        if (b && b.socketId) {
            b.status = "Behívva (Csörög)";
            io.to(b.socketId).emit('you-are-called');
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

    // ÚJ: Amikor az instruktor lezárja a futamot
    socket.on('complete-drive', ({ car, code }) => {
        let b = dailyBookings[car].find(x => x.code === code);
        if (b) {
            b.status = "Teljesített ✅";
            if (b.socketId && io.sockets.sockets.get(b.socketId)) {
                io.sockets.sockets.get(b.socketId).emit('drive-completed-screen');
            }
            io.to(car).emit('update-instructor-list', dailyBookings[car]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DRX Szerver fut a ${PORT}-es porton`));
