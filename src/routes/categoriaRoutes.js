const express = require('express');
const router = express.Router();
const catCtrl = require('../controllers/categoriaController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// Configuración médica → escritura reservada a Administrador y Técnico
const STAFF_CONFIG = [ROLES.ADMIN, ROLES.TECNICO];

// Listados (lectura abierta a cualquier staff autenticado)
router.get('/', verifyToken, catCtrl.listarActivas);
router.get('/inactivas', verifyToken, checkRole(STAFF_CONFIG), catCtrl.listarInactivas);
router.get('/:id', verifyToken, catCtrl.obtenerPorId);

// Operaciones de escritura
router.post('/', verifyToken, checkRole(STAFF_CONFIG), catCtrl.crear);
router.put('/:id', verifyToken, checkRole(STAFF_CONFIG), catCtrl.actualizar);
router.patch('/:id/reactivar', verifyToken, checkRole(STAFF_CONFIG), catCtrl.reactivar);
router.delete('/:id', verifyToken, checkRole(STAFF_CONFIG), catCtrl.desactivar);

module.exports = router;