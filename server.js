const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = [];
let currentPlayerIndex = 0;
let gameState = 'waiting'; // 'waiting', 'playing', 'ended'
let questionTimer = null;
const QUESTION_TIME_LIMIT = 10;

// Tablero ampliado a 24 casillas para que sea más largo y cueste más conseguir los premios
const boardCells = [
    { id: 0, type: 'special', name: 'Gran Comedor (Salida)' },
    { id: 1, type: 'normal', name: 'Pasillo del 3er Piso' },
    { id: 2, type: 'normal', name: 'Mazmorras Oscuras' },
    { id: 3, type: 'gryffindor', name: 'Torre Gryffindor 🦁' },
    { id: 4, type: 'normal', name: 'Patio de la Torre del Reloj' },
    { id: 5, type: 'normal', name: 'Clase de Defensa Contra las Artes Oscuras' },
    { id: 6, type: 'slytherin', name: 'Mazmorras Slytherin 🐍' },
    { id: 7, type: 'normal', name: 'Invernadero Nº 3' },
    { id: 8, type: 'normal', name: 'Cabaña de Hagrid' },
    { id: 9, type: 'ravenclaw', name: 'Sala Ravenclaw 🦅' },
    { id: 10, type: 'normal', name: 'Puente Colgante' },
    { id: 11, type: 'special', name: 'Biblioteca Prohibida' },
    { id: 12, type: 'hufflepuff', name: 'Sótano Hufflepuff 🦡' },
    { id: 13, type: 'normal', name: 'Lago Negro' },
    { id: 14, type: 'normal', name: 'Clase de Encantamientos' },
    { id: 15, type: 'gryffindor', name: 'Torre de Gryffindor (Norte) 🦁' },
    { id: 16, type: 'normal', name: 'Buhúrica' },
    { id: 17, type: 'slytherin', name: 'Dormitorios de Slytherin 🐍' },
    { id: 18, type: 'normal', name: 'Despacho del Director' },
    { id: 19, type: 'ravenclaw', name: 'Torre de Astronomía 🦅' },
    { id: 20, type: 'normal', name: 'Enfermería' },
    { id: 21, type: 'hufflepuff', name: 'Cocinas de Hogwarts 🦡' },
    { id: 22, type: 'special', name: 'Bosque Prohibido' },
    { id: 23, type: 'normal', name: 'Sala de Menesteres' }
];

// Banco de preguntas categorizado
const questionsBank = {
    gryffindor: [
        { question: "¿Cuál es el patronus de Harry Potter?", options: ["Ciervo", "Cierva", "Perro", "Fénix"], correct: 0 },
        { question: "¿Cómo se llama la lechuza de Harry?", options: ["Errol", "Crookshanks", "Hedwig", "Scabbers"], correct: 2 }
    ],
    slytherin: [
        { question: "¿Quién es el profesor de Pociones en el primer año?", options: ["Lupin", "Severus Snape", "Slughorn", "Lockhart"], correct: 1 },
        { question: "¿Cómo se llama la serpiente de Voldemort?", options: ["Nagini", "Basilisk", "Norbert", "Fang"], correct: 0 }
    ],
    ravenclaw: [
        { question: "¿Qué objeto mágico permite viajar en el tiempo?", options: ["Giratiempo", "Pensadero", "Capa", "Piedra"], correct: 0 },
        { question: "¿Cuál es la contraseña para entrar a la torre de Ravenclaw en los libros?", options: ["Una adivinanza", "¡Alohomora!", "Lumos", "Fortuna Major"], correct: 0 }
    ],
    hufflepuff: [
        { question: "¿Quién es el jefe de la casa Hufflepuff?", options: ["Pomona Sprout", "Minerva McGonagall", "Filius Flitwick", "Severus Snape"], correct: 0 },
        { question: "¿Qué objeto representa a Hufflepuff?", options: ["Una copa dorada", "Una diadema", "Una espada", "Un medallón"], correct: 0 }
    ],
    normal: [
        { question: "¿Cómo se llama el banco de los magos?", options: ["Gringotts", "Gringos", "Wizard Bank", "Vaults"], correct: 0 },
        { question: "¿Qué dulce hace que te salga humo por las orejas?", options: ["Pastillas Fizzing Whizzbees", "Ratones de Hielo", "Calderos de Chocolate", "Plumas de Alajú"], correct: 0 },
        { question: "¿En qué calle vive la familia Dursley?", options: ["Privet Drive", "Godric's Hollow", "Diagon Alley", "Spinner's End"], correct: 0 }
    ],
    special: [
        { question: "¿Cuál de las siguientes NO es una Reliquia de la Muerte?", options: ["Varita de Saúco", "Piedra Resurrección", "Sombrero Seleccionador", "Capa de Invisibilidad"], correct: 2 }
    ]
};

function startTimer() {
    let timeLeft = QUESTION_TIME_LIMIT;
    io.emit('timer-update', timeLeft);

    questionTimer = setInterval(() => {
        timeLeft--;
        io.emit('timer-update', timeLeft);

        if (timeLeft <= 0) {
            clearInterval(questionTimer);
            nextTurn();
        }
    }, 1000);
}

function nextTurn() {
    clearInterval(questionTimer);
    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    io.emit('update-game', { gameState, players, currentPlayerIndex, boardCells });
}

io.on('connection', (socket) => {
    console.log(`Mago conectado: ${socket.id}`);

    socket.on('join-game', (name) => {
        const newPlayer = {
            id: socket.id,
            name: name,
            score: 0,
            boardPosition: 0,
            badges: { gryffindor: false, slytherin: false, ravenclaw: false, hufflepuff: false },
            hasRolled: false,
            currentQuestion: null
        };
        players.push(newPlayer);
        io.emit('update-game', { gameState, players, currentPlayerIndex, boardCells });
    });

    socket.on('start-game', () => {
        if (gameState === 'waiting' && players.length > 0) {
            gameState = 'playing';
            currentPlayerIndex = 0;
            io.emit('update-game', { gameState, players, currentPlayerIndex, boardCells });
        }
    });

    socket.on('roll-dice', () => {
        const player = players[currentPlayerIndex];
        if (player && player.id === socket.id && !player.hasRolled && gameState === 'playing') {
            const diceRoll = Math.floor(Math.random() * 6) + 1;
            player.hasRolled = true;
            
            player.boardPosition = (player.boardPosition + diceRoll) % boardCells.length;
            
            const currentCell = boardCells[player.boardPosition];
            // Si la casilla es normal, elegimos una pregunta aleatoria de 'normal' o general
            const categoryPool = questionsBank[currentCell.type] || questionsBank.normal;
            const randomQ = categoryPool[Math.floor(Math.random() * categoryPool.length)];
            
            player.currentQuestion = randomQ;
            player.currentCellType = currentCell.type;

            io.emit('dice-rolled', { playerName: player.name, roll: diceRoll, position: player.boardPosition });
            io.emit('update-game', { gameState, players, currentPlayerIndex, boardCells });
            
            startTimer();
        }
    });

    socket.on('submit-answer', (optionIndex) => {
        const player = players[currentPlayerIndex];
        if (player && player.id === socket.id && player.currentQuestion && gameState === 'playing') {
            clearInterval(questionTimer);
            const currentQ = player.currentQuestion;

            if (optionIndex === currentQ.correct) {
                player.score += 15;
                socket.emit('correct-answer-feedback');

                // Si acierta en una casilla específica de casa, gana su estandarte
                if (['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff'].includes(player.currentCellType)) {
                    player.badges[player.currentCellType] = true;
                }

                // Condición de victoria: tener los 4 estandartes
                if (Object.values(player.badges).every(hasBadge => hasBadge)) {
                    gameState = 'ended';
                    io.emit('game-ended', player);
                    return;
                }
            } else {
                socket.emit('wrong-answer-feedback');
            }

            player.currentQuestion = null;
            player.hasRolled = false;
            
            nextTurn();
        }
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        if (players.length > 0) {
            currentPlayerIndex = currentPlayerIndex % players.length;
        } else {
            gameState = 'waiting';
        }
        io.emit('update-game', { gameState, players, currentPlayerIndex, boardCells });
        console.log(`Mago desconectado: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de Trivial Mágico corriendo en http://localhost:${PORT}`);
});