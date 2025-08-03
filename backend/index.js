require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Middleware para verificar token
function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Token requerido' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Token inválido' });
  }
}

// Crear tablas
app.get('/create-tables', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT false
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        score INTEGER CHECK (score BETWEEN 1 AND 5)
      );
    `);

    res.send('✅ Tablas creadas correctamente');
  } catch (error) {
    console.error('❌ Error al crear tablas:', error.message);
    res.status(500).send('❌ Error al crear las tablas');
  }
});

// Registro
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Faltan campos' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al registrar:', error.message);
    res.status(500).json({ error: 'Error al registrar' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Usuario no encontrado' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign(
      { id: user.id, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin } });
  } catch (error) {
    console.error('Error al iniciar sesión:', error.message);
    res.status(500).json({ error: 'Error en el servidor' });
  }
});

// Crear reseña (protegida)
app.post('/reviews', verificarToken, async (req, res) => {
  const { content } = req.body;
  const userId = req.user.id;

  if (!content) return res.status(400).json({ error: 'Contenido requerido' });

  try {
    const result = await pool.query(
      'INSERT INTO reviews (user_id, content) VALUES ($1, $2) RETURNING *',
      [userId, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear reseña:', error);
    res.status(500).json({ error: 'Error al guardar reseña' });
  }
});

// Listar reseñas con nombre de usuario
app.get('/reviews', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.content, r.created_at, u.name AS user_name
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener reseñas:', error.message);
    res.status(500).json({ error: 'Error al obtener reseñas' });
  }
});

// Test DB
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al conectar con la BD:', error);
    res.status(500).json({ error: 'Error de conexión a la BD' });
  }
});

app.delete('/reviews/:id', verificarToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Acceso solo para administradores' });
  }

  const reviewId = req.params.id;

  try {
    await pool.query('DELETE FROM reviews WHERE id = $1', [reviewId]);
    res.json({ message: 'Reseña eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar reseña:', error.message);
    res.status(500).json({ error: 'Error al eliminar reseña' });
  }
});

app.get('/drop-reviews', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS reviews CASCADE;');
    res.send('🗑 Tabla reviews eliminada correctamente.');
  } catch (error) {
    console.error('Error al eliminar tabla reviews:', error.message);
    res.status(500).send('Error al eliminar tabla');
  }
});

app.post('/crear-admin', async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, true) RETURNING id, name, email, is_admin',
      [name, email, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear admin:', error.message);
    res.status(500).json({ error: 'No se pudo crear el admin' });
  }
});


// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
