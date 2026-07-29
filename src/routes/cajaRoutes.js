const express = require('express');
const router = express.Router();
const cajaController = require('../controllers/cajaController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const CAJA = [ROLES.ADMIN, ROLES.ASISTENTE];

router.post('/abrir', verifyToken, checkRole(CAJA), cajaController.abrirTurno);
router.get('/actual', verifyToken, checkRole(CAJA), cajaController.obtenerTurnoActivo);
router.get('/ultimo-cierre', verifyToken, checkRole(CAJA), cajaController.obtenerUltimoCierre);
router.post('/cerrar', verifyToken, checkRole(CAJA), cajaController.cerrarTurno);
router.get('/historial', verifyToken, checkRole(CAJA), cajaController.listarCierres);
router.get('/cierre/:id', verifyToken, checkRole(CAJA), cajaController.obtenerDetalleCierre);

module.exports = router;