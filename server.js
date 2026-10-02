const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Estructura para almacenar las salas de juego: { pin: { players, gameState, currentPlayerIndex, boardCells, ... } }
const rooms = {};

// Preguntas del Trivial de Harry Potter
const questions = {
    gryffindor: [
        { question: "¿Cómo se llama elfantasma de Gryffindor?", options: ["Nick Casi Decapitado", "El Fraile Gordo", "La Dama Gris", "El Barón Sanguinario"], correct: 0 },
        { question: "¿Qué objeto saca Harry del Sombrero Seleccionador en la Cámara Secreta?", options: ["La Espada de Gryffindor", "La Diadema de Ravenclaw", "Un colmillo de Basilisco", "La Copa de Hufflepuff"], correct: 0 }
    ],
    slytherin: [
        { question: "¿Quién es el jefe de la casa Slytherin durante los primeros años de Harry?", options: ["Severus Snape", "Horace Slughorn", "Minerva McGonagall", "Filius Flitwick"], correct: 0 },
        { question: "¿Cuál es el animal que representa a la casa Slytherin?", options: ["Una serpiente", "Un león", "Un águila", "Un tejón"], correct: 0 }
    ],
    ravenclaw: [
        { question: "¿Qué objeto custodia la entrada a la sala común de Ravenclaw?", options: ["Una aldaba con una adivinanza", "Un cuadro con contraseña", "Una gárgola de piedra", "Un laberinto invisible"], correct: 0 },
        { question: "¿Cuál es el elemento asociado a la casa Ravenclaw?", options: ["Aire", "Fuego", "Agua", "Tierra"], correct: 0 }
    ],
    hufflepuff: [
        { question: "¿Quién es el fundador de la casa Hufflepuff?", options: ["Helga Hufflepuff", "Rowena Ravenclaw", "Salazar Slytherin", "Godric Gryffindor"], correct: 0 },
        { question: "¿Dónde se encuentra la entrada a la cocina de Hogwarts?", options: ["Cerca de los barriles de Hufflepuff", "En el gran comedor", "En la torre de astronomía", "En el calabozo"], correct: 0 }
    ],
    normal: [
        { question: "¿Cómo se llama el callejón donde los magos compran sus materiales escolares?", options: ["Callejón Diagon", "Callejón Knockturn", "Hogsmeade", "Andén 9 y 3/4"], correct: 0 },
        { question: "¿Cuál es el hechizo para desarmar a un oponente?", options: ["Expelliarmus", "Stupefy", "Lumos", "Avada Kedavra"], correct: 0 }
    ],
    special: [
        { question: "¿Cuántos hermanos Weasley hay en total?", options: ["7", "5", "6", "8"], correct: 0 },
        { question: "¿Quién mató a Sirius Black?", options: ["Bellatrix Lestrange", "Lucius Malfoy", "Severus Snape", "Lord Voldemort"], correct: 0 }
    ]
};

function generateBoard() {
    const types = ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff', 'normal', 'special'];
    let cells = [];
    for (let i = 0; i < 24; i++) {
        let type = types[i % types.length];
        cells.push({ id: i, type: type, name: type.toUpperCase() });
    }
    return cells;
}

io.on('connection', (socket) => {
    let currentRoomPin = null;

    // Crear una nueva sala privada
    socket.on('create-room', (playerName) => {
        // Generar un PIN aleatorio de 4 dígitos
        const pin = Math.floor(1000 + Math.random() * 9000).toString();
        currentRoomPin = pin;

        rooms[pin] = {
            pin: pin,
            players: [{
                id: socket.id,
                name: playerName,
                boardPosition: 0,
                score: 0,
                badges: { gryffindor: false, slytherin: false, ravenclaw: false, hufflepuff: false },
                hasRolled: false,
                currentQuestion: null,
                currentCellType: null
            }],
            gameState: 'waiting', // waiting, playing, ended
            currentPlayerIndex: 0,
            boardCells: generateBoard(),
            timer: null,
            timeLeft: 15
        };

        socket.join(pin);
        socket.emit('room-created', pin);
        updateRoomState(pin);
    });

    // Unirse a una sala existente mediante PIN
    socket.on('join-room', ({ pin, playerName }) => {
        if (!rooms[pin]) {
            socket.emit('error-message', '¡Esa sala no existe o el PIN es incorrecto!');
            return;
        }

        if (rooms[pin].gameState !== 'waiting') {
            socket.emit('error-message', 'La partida en esta sala ya ha comenzado.');
            return;
        }

        currentRoomPin = pin;
        socket.join(pin);

        rooms[pin].players.push({
            id: socket.id,
            name: playerName,
            boardPosition: 0,
            score: 0,
            badges: { gryffindor: false, slytherin: false, ravenclaw: false, hufflepuff: false },
            hasRolled: false,
            currentQuestion: null,
            currentCellType: null
        });

        socket.emit('room-joined', pin);
        updateRoomState(pin);
    });

    // Iniciar la partida en la sala
    socket.on('start-game', () => {
        if (!currentRoomPin || !rooms[currentRoomPin]) return;
        const room = rooms[currentRoomPin];
        
        // Solo el líder (primer jugador) puede iniciar
        if (room.players[0].id === socket.id && room.players.length >= 1) {
            room.gameState = 'playing';
            updateRoomState(currentRoomPin);
        }
    });

    // Tirar el dado
    socket.on('roll-dice', () => {
        if (!currentRoomPin || !rooms[currentRoomPin]) return;
        const room = rooms[currentRoomPin];
        const player = room.players[room.currentPlayerIndex];

        if (player && player.id === socket.id && !player.hasRolled && room.gameState === 'playing') {
            const roll = Math.floor(Math.random() * 6) + 1;
            player.hasRolled = true;
            
            io.to(currentRoomPin).emit('dice-rolled', { playerName: player.name, roll });

            player.boardPosition = (player.boardPosition + roll) % room.boardCells.length;
            const cell = room.boardCells[player.boardPosition];
            player.currentCellType = cell.type;

            const categoryQuestions = questions[cell.type] || questions.normal;
            const randomQ = categoryQuestions[Math.floor(Math.random() * categoryQuestions.length)];
            player.currentQuestion = randomQ;

            updateRoomState(currentRoomPin);
            startQuestionTimer(currentRoomPin);
        }
    });

    // Enviar respuesta
    socket.on('submit-answer', (optionIndex) => {
        if (!currentRoomPin || !rooms[currentRoomPin]) return;
        const room = rooms[currentRoomPin];
        const player = room.players[room.currentPlayerIndex];

        if (player && player.id === socket.id && player.currentQuestion) {
            clearInterval(room.timer);
            const correct = player.currentQuestion.correct;

            if (optionIndex === correct) {
                player.score += 10;
                if (player.badges.hasOwnProperty(player.currentCellType)) {
                    player.badges[player.currentCellType] = true;
                }
                socket.emit('correct-answer-feedback');
            } else {
                socket.emit('wrong-answer-feedback');
            }

            // Comprobar victoria (tener todos los estandartes)
            if (player.badges.gryffindor && player.badges.slytherin && player.badges.ravenclaw && player.badges.hufflepuff) {
                room.gameState = 'ended';
                io.to(currentRoomPin).emit('game-ended', player);
                updateRoomState(currentRoomPin);
                return;
            }

            nextTurn(currentRoomPin);
        }
    });

    // Desconexión
    socket.on('disconnect', () => {
        if (currentRoomPin && rooms[currentRoomPin]) {
            const room = rooms[currentRoomPin];
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                delete rooms[currentRoomPin];
            } else {
                if (room.currentPlayerIndex >= room.players.length) {
                    room.currentPlayerIndex = 0;
                }
                updateRoomState(currentRoomPin);
            }
        }
    });
});

function startQuestionTimer(pin) {
    const room = rooms[pin];
    if (!room) return;

    room.timeLeft = 15;
    if (room.timer) clearInterval(room.timer);

    room.timer = setInterval(() => {
        room.timeLeft--;
        io.to(pin).emit('timer-update', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(room.timer);
            // Tiempo agotado, cuenta como fallo
            nextTurn(pin);
        }
    }, 1000);
}

function nextTurn(pin) {
    const room = rooms[pin];
    if (!room) return;

    const player = room.players[room.currentPlayerIndex];
    if (player) {
        player.hasRolled = false;
        player.currentQuestion = null;
        player.currentCellType = null;
    }

    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    updateRoomState(pin);
}

function updateRoomState(pin) {
    const room = rooms[pin];
    if (room) {
        io.to(pin).emit('update-game', {
            gameState: room.gameState,
            players: room.players,
            currentPlayerIndex: room.currentPlayerIndex,
            boardCells: room.boardCells,
            pin: room.pin
        });
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});