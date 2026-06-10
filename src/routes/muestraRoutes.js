const express = require('express');
const router = express.Router();
const muestraCtrl = require('../controllers/muestraController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


// 1. Secretaria registra que ya tomó la muestra
router.post('/recoleccion', verifyToken, muestraCtrl.confirmarRecoleccion);

// 2. Insumos por orden — DEBE ir ANTES de /buscar/:codigo
//    porque Express evalúa rutas en orden y /buscar/:codigo capturaría /insumos/6
router.get('/insumos/:id_orden', verifyToken, muestraCtrl.obtenerInsumos);

// 3. Especialista busca la muestra por el código escrito a mano
//    Ruta genérica con parámetro dinámico — siempre al final
router.get('/buscar/:codigo', verifyToken, muestraCtrl.buscarPorMarcadoManual);


// GET /muestras/historial — Historial completo para la gestión y filtros en el módulo de muestras
router.get('/historial', verifyToken, muestraCtrl.obtenerHistorialMuestras);
module.exports = router;