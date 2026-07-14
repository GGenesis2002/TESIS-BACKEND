const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
const { verifyToken } = require('../middlewares/authMiddleware');

// POST /caja/abrir — Abre un nuevo turno de caja (fondo inicial de efectivo)
router.post('/abrir', verifyToken, cajaController.abrirTurno);

// GET /caja/actual — Turno de caja abierto de la secretaria autenticada
router.get('/actual', verifyToken, cajaController.obtenerTurnoActivo);

// GET /caja/ultimo-cierre — Último cierre de caja registrado en el sistema
// (de cualquier secretaria), para mostrarlo antes de abrir un turno nuevo
router.get('/ultimo-cierre', verifyToken, cajaController.obtenerUltimoCierre);

// POST /caja/cerrar — Cierra el turno de caja activo (arqueo de caja)
router.post('/cerrar', verifyToken, cajaController.cerrarTurno);

// GET /caja/historial — Historial de todos los cierres de caja realizados
router.get('/historial', verifyToken, cajaController.listarCierres);

// GET /caja/cierre/:id — Detalle de un cierre específico (para imprimir)
router.get('/cierre/:id', verifyToken, cajaController.obtenerDetalleCierre);

module.exports = router;