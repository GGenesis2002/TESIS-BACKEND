const express = require('express');
const router = express.Router();
const muestraCtrl = require('../controllers/muestraController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Validación de toma de muestras" está asignada a Asistente Analista.
const TOMA_MUESTRAS = [ROLES.ADMIN, ROLES.ASISTENTE];
// La búsqueda por código la usa el Especialista al procesar la muestra.
const BUSQUEDA_MUESTRA = [ROLES.ADMIN, ROLES.ESPECIALISTA, ROLES.ASISTENTE];

// 1. Secretaria registra que ya tomó la muestra
router.post('/recoleccion', verifyToken, checkRole(TOMA_MUESTRAS), muestraCtrl.confirmarRecoleccion);

// 2. Insumos por orden — DEBE ir ANTES de /buscar/:codigo
router.get('/insumos/:id_orden', verifyToken, checkRole(TOMA_MUESTRAS), muestraCtrl.obtenerInsumos);

// 3. Especialista busca la muestra por el código escrito a mano
router.get('/buscar/:codigo', verifyToken, checkRole(BUSQUEDA_MUESTRA), muestraCtrl.buscarPorMarcadoManual);

// Historial completo para gestión y filtros
router.get('/historial', verifyToken, checkRole(TOMA_MUESTRAS), muestraCtrl.obtenerHistorialMuestras);

module.exports = router;