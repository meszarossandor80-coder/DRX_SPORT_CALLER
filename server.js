const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- FIX ADATOK ---
const AUTOK = [
    "Ferrari 458", "Ferrari 458 Challenge", "Lamborghini Huracane", 
    "Dodge Challenger Hellcat", "Ferrari 488", "Ferrari F8", 
    "Mercedes-AMG GT 63 Pro", "Porsche 911 GT3", "Mustang eleanor", 
    "Ford Mustang Shelby GT350", "Nissan GT-R", "Formula", "Mitsubishi Evo IX"
];

const INSTRUKTOROK = ["Bandi", "Csabi Huba", "Geri", "Sanya"];

// --- RENDSZER MEMÓRIA ---
let vendegek = []; 
let aktivInstruktorok = {}; // { "InstruktorNev": "Autó" }

// --- API VÉGPONTOK ---
app.get('/api/autok', (req, res) => res.json(AUTOK));
app.get('/api/instruktorok', (req, res) => res.json(INSTRUKTOROK));

// --- REAL-TIME LOGIKA (SOCKET.IO) ---
io.on('connection', (socket) => {
    // Kezdeti adatok küldése a csatlakozónak
    socket.emit('vendegekFrissitese', vendegek);
    socket.emit('instruktorokFrissitese', aktivInstruktorok);

    // 1. IRODA: Új vendég rögzítése
    socket.on('ujVendeg', (ujVendegAdat) => {
        const vendeg = {
            id: ujVendegAdat.id.trim(),
            nev: ujVendegAdat.nev,
            idopont: ujVendegAdat.idopont,
            auto: ujVendegAdat.auto,
            korszam: parseInt(ujVendegAdat.korszam),
            extra: ujVendegAdat.extra,
            status: 'MEGÉRKEZETT',
            ertekeles: null,
            eszrevetel: ""
        };
        
        if (!vendegek.some(v => v.id === vendeg.id)) {
            vendegek.push(vendeg);
            io.emit('vendegekFrissitese', vendegek);
        } else {
            socket.emit('hiba', 'Ez az egyedi azonosító már foglalt!');
        }
    });

    // 2. INSTRUKTOR: Autó kiválasztása / Bejelentkezés
    socket.on('instruktorBejelentkezes', ({ nev, auto }) => {
        aktivInstruktorok[nev] = auto;
        io.emit('instruktorokFrissitese', aktivInstruktorok);
    });

    // 3. VENDÉG: Sorba állás (Zöld státusz)
    socket.on('vendegBejelentkezesVezetesre', (vendegId) => {
        const vendeg = vendegek.find(v => v.id === vendegId);
        if (vendeg && vendeg.status === 'MEGÉRKEZETT') {
            vendeg.status = 'VEZETÉSRE_VÁR';
            io.emit('vendegekFrissitese', vendegek);
        }
    });

    // 4. INSTRUKTOR: Vendég hívása (Kék státusz + sziréna)
    socket.on('vendegHivasa', (vendegId) => {
        const vendeg = vendegek.find(v => v.id === vendegId);
        if (vendeg) {
            vendeg.status = 'BEHÍVVA';
            io.emit('vendegekFrissitese', vendegek);
            io.emit(`hangjelzes_${vendegId}`); 
        }
    });

    // 5. INSTRUKTOR: Menet lezárása (Értékelő ablak felugrik a vendégnél)
    socket.on('menetLezarasa', (vendegId) => {
        const vendeg = vendegek.find(v => v.id === vendegId);
        if (vendeg) {
            vendeg.status = 'TELJESÍTETT';
            io.emit('vendegekFrissitese', vendegek);
            io.emit(`ertekelesreKeres_${vendegId}`); 
        }
    });

    // 6. VENDÉG: Értékelés mentése
    socket.on('ertekelesBekuldese', ({ vendegId, pontszam, eszrevetel }) => {
        const vendeg = vendegek.find(v => v.id === vendegId);
        if (vendeg) {
            vendeg.ertekeles = parseInt(pontszam);
            vendeg.eszrevetel = eszrevetel;
            io.emit('vendegekFrissitese', vendegek); 
        }
    });
});

server.listen(PORT, () => {
    console.log(`A DRX Rendszer sikeresen elindult.`);
});
