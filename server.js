const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { initDB } = require('./db/schema');
const { seedDB } = require('./db/seed');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'attendance-tec-secret-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const db = initDB();
seedDB(db);

app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/student', require('./routes/student')(db));
app.use('/api/faculty', require('./routes/faculty')(db));
app.use('/api/admin', require('./routes/admin')(db));

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Attendance @TEC running on http://localhost:${PORT}`));
