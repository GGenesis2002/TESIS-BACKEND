const express = require('express');
const router = express.Router();
const pagoController = require('../controllers/pagoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Cobros/pagos" está asignado a Asistente Analista (Secretaria); Administrador
// necesita verlo todo para supervisión.
const CAJA = [ROLES.ADMIN, ROLES.ASISTENTE];

router.post('/procesar', verifyToken, checkRole(CAJA), pagoController.procesarCobro);
router.get('/hoy', verifyToken, checkRole(CAJA), pagoController.verPagosHoy);
router.get('/ordenes-generadas', verifyToken, checkRole(CAJA), pagoController.obtenerOrdenesGeneradas);
router.get('/todos', verifyToken, checkRole(CAJA), pagoController.verTodosPagos);
router.post('/reembolsar', verifyToken, checkRole(CAJA), pagoController.procesarReembolso);
router.get('/reembolsos', verifyToken, checkRole(CAJA), pagoController.verReembolsos);

module.exports = router;