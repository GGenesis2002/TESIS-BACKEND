const express = require('express');
const router = express.Router();
const asigCtrl = require('../controllers/asignacionController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// Asignar exámenes/carga de trabajo a especialistas es una función administrativa.
const ADMIN_ONLY = [ROLES.ADMIN, ROLES.TECNICO];

router.post('/', verifyToken, checkRole(ADMIN_ONLY), asigCtrl.asignar);
router.get('/', verifyToken, checkRole(ADMIN_ONLY), asigCtrl.listar);
router.post('/remover', verifyToken, checkRole(ADMIN_ONLY), asigCtrl.desasignarExamen);
router.delete('/:id', verifyToken, checkRole(ADMIN_ONLY), asigCtrl.quitarAsignacion);

module.exports = router;