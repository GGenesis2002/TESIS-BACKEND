const express = require('express');
const router = express.Router();
const ordenCtrl = require('../controllers/ordenController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Órdenes médicas" está asignado a Administrador y Asistente Analista (Secretaria)
const GESTION_ORDENES = [ROLES.ADMIN, ROLES.ASISTENTE];
const TODOS = [ROLES.ADMIN, ROLES.ASISTENTE, ROLES.ESPECIALISTA, ROLES.TECNICO]

// Dashboard y Búsqueda (staff)
router.get('/', verifyToken, checkRole(TODOS), ordenCtrl.listar); // ?estado=Generada
router.post('/buscar', verifyToken, checkRole(TODOS), ordenCtrl.buscarOrden);

// Acciones del Paciente — SOLO el propio paciente.
// ⚠️ El controlador debe tomar el id_paciente de req.user (token), NUNCA del body,
// para que un paciente no pueda generar/editar órdenes de otro paciente (IDOR).
router.post('/paciente/generar', verifyToken, checkRole([ROLES.PACIENTE]), ordenCtrl.crearPorPaciente);
router.put('/paciente/:id/editar', verifyToken, checkRole([ROLES.PACIENTE]), ordenCtrl.editarPorPaciente);

// Acciones de la Secretaria / Administración
router.put('/secretaria/corregir', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.corregirOrden);
router.post('/secretaria/pagar', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.pagarOrden);
router.put('/regenerar-qr', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.regenerarQR);
router.patch('/:id/cancelar', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.cancelar);



router.get('/:id/detalle', verifyToken, checkRole([...TODOS, ROLES.PACIENTE]), ordenCtrl.obtenerDetalle);

module.exports = router;