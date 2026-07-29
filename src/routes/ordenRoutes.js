const express = require('express');
const router = express.Router();
const ordenCtrl = require('../controllers/ordenController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Órdenes médicas" está asignado a Administrador y Asistente Analista (Secretaria)
const GESTION_ORDENES = [ROLES.ADMIN, ROLES.ASISTENTE];
const TODOS = [ROLES.ADMIN, ROLES.ASISTENTE, ROLES.ESPECIALISTA, ROLES.TECNICO, ROLES.PACIENTE]

// Dashboard y Búsqueda (staff)
router.get('/', verifyToken, checkRole(TODOS), ordenCtrl.listar); // ?estado=Generada
router.post('/buscar', verifyToken, checkRole(TODOS), ordenCtrl.buscarOrden);

// Acciones del Paciente — SOLO el propio paciente.
// ⚠️ El controlador debe tomar el id_paciente de req.user (token), NUNCA del body,
// para que un paciente no pueda generar/editar órdenes de otro paciente (IDOR).
router.post('/paciente/generar', verifyToken, checkRole([ROLES.PACIENTE, ROLES.ASISTENTE, ROLES.ADMIN]), ordenCtrl.crearPorPaciente);
router.put('/paciente/:id/editar', verifyToken, checkRole([ROLES.PACIENTE, ROLES.ASISTENTE, ROLES.ADMIN]), ordenCtrl.editarPorPaciente);

// Acciones de la Secretaria / Administración
router.put('/secretaria/corregir', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.corregirOrden);
router.post('/secretaria/pagar', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.pagarOrden);
router.put('/regenerar-qr', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.regenerarQR);
router.patch('/:id/cancelar', verifyToken, checkRole(GESTION_ORDENES), ordenCtrl.cancelar);



// ✅ FIX: TODOS ya es un arreglo — envolverlo en [TODOS] lo anida dos niveles
// y checkRole solo aplana UN nivel (.flat()), así que la comparación de roles
// nunca coincidía y esta ruta devolvía 403 para cualquier usuario, sin importar
// su rol. Se usa TODOS directamente, igual que en las otras rutas de este archivo.
router.get('/:id/detalle', verifyToken, checkRole(TODOS), ordenCtrl.obtenerDetalle);

module.exports = router;