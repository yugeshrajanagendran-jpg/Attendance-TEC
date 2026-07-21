const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { initDB } = require('./db/schema');
const { seedDB } = require('./db/seed');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be configured in production');
}

const app = express();
app.set('trust proxy', 1);
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',');
app.use(cors({ origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
}, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

const db = initDB();
seedDB(db);

app.use('/api/auth', require('./routes/auth')(db));
app.use('/api/student', require('./routes/student')(db));
app.use('/api/faculty', require('./routes/faculty')(db));
app.use('/api/admin', require('./routes/admin')(db));
app.use('/api/superadmin', require('./routes/superadmin')(db));

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Attendance @TEC running on http://localhost:${PORT}`));
