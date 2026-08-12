require('dotenv').config();
require('./jobs/Notificacioncronjob');
require('./helpers/scheduledTasks'); // ← activa los cron jobs al iniciar el servidor
const express = require('express');

app.set('trust proxy', 1);


const cors = require('cors');
const morgan = require('morgan');
const path = require('path');



// --- 1. IMPORTAR LAS 17 RUTAS ---
const adminRoutes = require('./routes/admin');
const asignacionRoutes = require('./routes/asignacionRoutes');
const categoriaRoutes = require('./routes/categoriaRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const examenRoutes = require('./routes/examenRoutes');
const insumoRoutes = require('./routes/insumoRoutes');
const loginRoutes = require('./routes/loginRoutes');
const muestraRoutes = require('./routes/muestraRoutes');
const ordenRoutes = require('./routes/ordenRoutes');
const pacienteRoutes = require('./routes/pacienteRoutes');
const pagoRoutes = require('./routes/pagoRoutes');
const cajaRoutes = require('./routes/cajaRoutes');
const parametroRoutes = require('./routes/parametroRoutes');
const personalRoutes = require('./routes/personalRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const configuracionRoutes = require("./routes/configuracionRoutes");
const notificacionRoutes = require('./routes/notificacionRoutes');
const tipoMuestraRoutes = require('./routes/tipoMuestraRoutes');
const resultadoRoutes = require('./routes/resultadoRoutes');

// Rutas adicionales para el flujo de PDF y Validación (Asegúrate de tener estos archivos)
const validacionRoutes = require('./routes/validacionRoutes'); 
const reporteRoutes = require('./routes/reporteRoutes');
const documentoRoutes = require("./routes/documento.routes");

const app = express();

// --- 2. MIDDLEWARES GLOBALES ---
const allowedOrigins = [
    process.env.FRONTEND_URL,        // producción
    'http://localhost:3000',         // desarrollo local (ajusta el puerto)
    'http://localhost:5173',         // si usas Vite
].filter(Boolean); // quita entradas undefined si alguna var no está seteada

if (!process.env.FRONTEND_URL) {
    console.error('⚠️ FRONTEND_URL no está definida — solo se permitirá acceso desde localhost.');
}

app.use(cors({
    origin: function (origin, callback) {
        // Permite peticiones sin origin (ej. Postman, apps móviles, curl)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️ CORS bloqueado para origin: ${origin}`);
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true // solo si usas cookies; si usas JWT en header, puedes quitarlo
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SERVIR ARCHIVOS ESTÁTICOS (Para PDFs, QR y Firmas)
app.use('/storage', express.static(path.join(__dirname, '../storage')));

// --- 3. DEFINICIÓN DE ENDPOINTS ---

// Test
app.get('/', (req, res) => res.json({ msg: "API LABORATORIO CG v2 - 17 Rutas Activas" }));

// Autenticación y Usuarios
app.use('/api/login', loginRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/personal', personalRoutes);
app.use("/api/configuracion", configuracionRoutes);

// Configuración Médica
app.use('/api/categorias', categoriaRoutes);
app.use('/api/examenes', examenRoutes);
app.use('/api/parametros', parametroRoutes);
app.use('/api/muestras', muestraRoutes);

// Operación y Pacientes
app.use('/api/pacientes', pacienteRoutes);
app.use('/api/ordenes', ordenRoutes);
app.use('/api/pagos', pagoRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/validaciones', validacionRoutes);
app.use('/api/reportes', reporteRoutes);
app.use("/api/documento", documentoRoutes);

// Inventario y Logística
app.use('/api/insumos', insumoRoutes);
app.use('/api/asignaciones', asignacionRoutes);
app.use('/api/tipo-muestra', tipoMuestraRoutes);
app.use('/api/usos-adicionales', require('./routes/usoAdicionalRoutes'));

// Dashboard
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notificaciones', notificacionRoutes);

//Resultados
app.use('/api/resultados', resultadoRoutes);


// --- 4. MANEJO DE ERRORES ---
app.use((req, res) => res.status(404).json({ msg: "Ruta no encontrada" }));

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ msg: "Error interno del servidor" });
});

// === >>> ¡AQUÍ COLOCAS EL NUEVO CÓDIGO! <<< ===

// --- 5. INICIAR EL SERVIDOR Y VERIFICAR BD ---
const PORT = process.env.PORT || 4000;
const pool = require('./config/db'); // Importa tu conexión a PostgreSQL

// Función para probar la conexión a PostgreSQL
async function verificarBaseDatos() {
    try {
        const res = await pool.query('SELECT NOW()');
        console.log('✅ CONEXIÓN EXITOSA A LA BASE DE DATOS:', res.rows[0].now);
    } catch (err) {
        console.error('❌ ERROR AL CONECTAR A LA BASE DE DATOS:');
        console.error(err.message);
    }
}

// Ponemos al servidor a escuchar
app.listen(PORT, async () => {
    console.log(`=================================================`);
    console.log(`🚀 SERVIDOR CORRIENDO EN EL PUERTO: ${PORT}`);
    console.log(`🌐 URL BASE LOCAL: http://localhost:${PORT}`);
    
    // Ejecutamos la prueba de la BD al levantar el servidor
    await verificarBaseDatos(); 
    
    console.log(`=================================================`);
});

module.exports = app;