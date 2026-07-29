const express = require('express');
const router = express.Router();
const examenCtrl = require('../controllers/examenController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const STAFF_CONFIG = [ROLES.ADMIN, ROLES.TECNICO];

// Listados (lectura abierta a cualquier staff autenticado)
router.get('/', verifyToken, examenCtrl.listarActivos);
router.get('/inactivos', verifyToken, checkRole(STAFF_CONFIG), examenCtrl.listarInactivos);
router.get('/:id', verifyToken, examenCtrl.obtenerPorId);

// Operaciones de escritura
router.post('/', verifyToken, checkRole(STAFF_CONFIG), examenCtrl.crear);
router.put('/:id', verifyToken, checkRole(STAFF_CONFIG), examenCtrl.actualizar);
router.patch('/:id/reactivar', verifyToken, checkRole(STAFF_CONFIG), examenCtrl.reactivar);
router.delete('/:id', verifyToken, checkRole(STAFF_CONFIG), examenCtrl.desactivar);

module.exports = router;