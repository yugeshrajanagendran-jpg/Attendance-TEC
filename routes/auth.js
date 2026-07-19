const express = require('express');
const bcrypt = require('bcryptjs');

module.exports = function(db) {
    const router = express.Router();

    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: 'Missing credentials' });

        try {
            const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
            if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials. Please check your username and password.' });

            const valid = bcrypt.compareSync(password, user.password);
            if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials. Please check your username and password.' });

            req.session.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name
            };

            res.json({ success: true, user: req.session.user });
        } catch (error) {
            res.status(500).json({ success: false, message: 'Server error' });
        }
    });

    router.post('/logout', (req, res) => {
        req.session.destroy();
        res.json({ message: 'Logged out successfully' });
    });

    router.get('/me', (req, res) => {
        if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
        
        try {
            const userId = req.session.user.id;
            const role = req.session.user.role;
            let profile = { ...req.session.user };

            if (role === 'student') {
                const s = db.prepare('SELECT email, phone FROM students WHERE user_id = ?').get(userId);
                if (s) {
                    profile.email = s.email;
                    profile.phone = s.phone;
                }
            } else if (role === 'faculty') {
                const f = db.prepare('SELECT email FROM faculty WHERE user_id = ?').get(userId);
                if (f) {
                    profile.email = f.email;
                }
                // Phone is stored in users table for faculty
                const u = db.prepare('SELECT phone FROM users WHERE id = ?').get(userId);
                if (u) {
                    profile.phone = u.phone || '';
                }
            }
            res.json(profile);
        } catch (err) {
            res.json(req.session.user);
        }
    });

    const { requireAuth } = require('../middleware/auth');

    router.put('/settings', requireAuth, (req, res) => {
        const userId = req.session.user.id;
        const { email, phone, current_password, new_password } = req.body;

        try {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
            if (!user) return res.status(404).json({ error: 'User not found' });

            db.transaction(() => {
                if (current_password && new_password) {
                    const valid = bcrypt.compareSync(current_password, user.password);
                    if (!valid) throw new Error('Incorrect current password');
                    
                    const hashed = bcrypt.hashSync(new_password, 10);
                    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId);
                }

                if (email !== undefined) {
                    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
                    req.session.user.email = email;
                }

                if (user.role === 'student') {
                    db.prepare('UPDATE students SET email = ?, phone = ? WHERE user_id = ?')
                      .run(email || null, phone || null, userId);
                } else if (user.role === 'faculty') {
                    db.prepare('UPDATE faculty SET email = ? WHERE user_id = ?')
                      .run(email || null, userId);
                    // Store phone in users table for faculty (add column if not exists)
                    try {
                        db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
                    } catch(e) { /* column already exists, ignore */ }
                    if (phone !== undefined) {
                        db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone || null, userId);
                    }
                }
            })();

            res.json({ success: true, message: 'Settings updated successfully' });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Server error' });
        }
    });

    router.get('/notifications', requireAuth, (req, res) => {
        try {
            const userId = req.session.user.id;
            const list = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
            res.json(list);
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.put('/notifications/:id/read', requireAuth, (req, res) => {
        try {
            const userId = req.session.user.id;
            db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, userId);
            res.json({ success: true, message: 'Notification marked as read' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.put('/notifications/read-all', requireAuth, (req, res) => {
        try {
            const userId = req.session.user.id;
            db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
            res.json({ success: true, message: 'All notifications marked as read' });
        } catch (error) {
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};
