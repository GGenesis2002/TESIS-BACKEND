const express = require('express');
const router = express.Router();
const pagoController = require('../controllers/pagoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


// POST /pagos/procesar — Registra el cobro de una orden
router.post('/procesar', verifyToken, pagoController.procesarCobro);

// GET /pagos/hoy — Reporte de pagos del día (cierre de caja)
router.get('/hoy', verifyToken, pagoController.verPagosHoy);

// GET /pagos/ordenes-generadas — Órdenes pendientes de cobro para la vista de caja
// (el frontend antes hacía GET /ordenes?estado=Generada; ahora tiene su propio endpoint
//  que ya incluye nombres/apellidos/cédula del paciente)
router.get('/ordenes-generadas', verifyToken, pagoController.obtenerOrdenesGeneradas);

// GET /pagos/todos — Historial completo de pagos para filtros avanzados en caja
router.get('/todos', verifyToken, pagoController.verTodosPagos);

// POST /pagos/reembolsar — Registra el reembolso (total o parcial) de una orden pagada
router.post('/reembolsar', verifyToken, pagoController.procesarReembolso);

// GET /pagos/reembolsos — Historial de reembolsos procesados
router.get('/reembolsos', verifyToken, pagoController.verReembolsos);

module.exports = router;