const express = require('express');
const router = express.Router();
const ordenCtrl = require('../controllers/ordenController');
const {verifyToken} = require('../middlewares/authMiddleware');

// Dashboard y Búsqueda
router.get('/', verifyToken, ordenCtrl.listar); // ?estado=Generada
router.post('/buscar', verifyToken, ordenCtrl.buscarOrden); 

// Acciones del Paciente
router.post('/paciente/generar', verifyToken, ordenCtrl.crearPorPaciente);

// Acciones de la Secretaria
router.put('/secretaria/corregir', verifyToken, ordenCtrl.corregirOrden);
router.post('/secretaria/pagar', verifyToken, ordenCtrl.pagarOrden);
router.put('/regenerar-qr', verifyToken, ordenCtrl.regenerarQR);
router.patch('/:id/cancelar', verifyToken, ordenCtrl.cancelar);

// En ordenRoutes.js, abajo de router.get('/', verifyToken, ordenCtrl.listar);
router.get('/:id/detalle', verifyToken, ordenCtrl.obtenerDetalle);
module.exports = router;