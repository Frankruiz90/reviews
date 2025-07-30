const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Usa variables de entorno
  ssl: { rejectUnauthorized: false } // Para Render.com o Supabase
});

// Crear tabla si no existe
app.get('/init', async (req, res) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(100)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'pendiente',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  res.send('Tablas creadas');
});

// POST /comments
app.post('/comments', async (req, res) => {
  const { name, email, content } = req.body;

  let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (user.rows.length === 0) {
    await pool.query('INSERT INTO users (name, email) VALUES ($1, $2)', [name, email]);
    user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  }

  const userId = user.rows[0].id;
  const result = await pool.query(
    'INSERT INTO comments (user_id, content) VALUES ($1, $2) RETURNING *',
    [userId, content]
  );

  res.json(result.rows[0]);
});

// GET /comments
app.get('/comments', async (req, res) => {
  const result = await pool.query(`
    SELECT comments.id, users.name, users.email, comments.content, comments.status, comments.created_at
    FROM comments
    JOIN users ON users.id = comments.user_id
    ORDER BY comments.created_at DESC
  `);
  res.json(result.rows);
});

// PATCH /comments/:id
app.patch('/comments/:id', async (req, res) => {
  const { status } = req.body;
  const result = await pool.query(
    'UPDATE comments SET status = $1 WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  res.json(result.rows[0]);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
