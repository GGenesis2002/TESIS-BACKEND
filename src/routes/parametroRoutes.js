const express = require('express');
const router = express.Router();
const paramCtrl = require('../controllers/parametroController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Parámetros de exámenes" está explícitamente asignado a Técnico en el
// reglamento; Administrador tiene acceso general de configuración médica.
const STAFF_CONFIG = [ROLES.ADMIN, ROLES.TECNICO];

// Listar parámetros de un examen específico (lectura abierta a staff autenticado)
router.get('/examen/:id_examen', verifyToken, paramCtrl.listarPorExamen);
router.get('/examen/:id_examen/inactivos', verifyToken, checkRole(STAFF_CONFIG), paramCtrl.listarInactivosPorExamen);
router.get('/', verifyToken, paramCtrl.listarTodos);

// Operaciones individuales
router.post('/', verifyToken, checkRole(STAFF_CONFIG), paramCtrl.crear);
router.put('/:id', verifyToken, checkRole(STAFF_CONFIG), paramCtrl.actualizar);
router.patch('/:id/reactivar', verifyToken, checkRole(STAFF_CONFIG), paramCtrl.reactivar);
router.delete('/:id', verifyToken, checkRole(STAFF_CONFIG), paramCtrl.desactivar);

module.exports = router;