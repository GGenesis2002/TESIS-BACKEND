const express = require('express');
const router = express.Router();
const personalController = require('../controllers/personalController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

// "Gestión de personal" está explícitamente asignada a Técnico en el
// reglamento; Administrador también debe poder gestionarlo.
const STAFF_RRHH = [ROLES.ADMIN, ROLES.TECNICO];
const STAFF_RRHH_AMPLIO = [ROLES.ADMIN, ROLES.TECNICO, ROLES.ESPECIALISTA, ROLES.ASISTENTE];

router.get('/', verifyToken, checkRole(STAFF_RRHH_AMPLIO), personalController.listarPersonal);
router.get('/consultar-cedula/:cedula', verifyToken, checkRole(STAFF_RRHH), personalController.consultarPorCedula);
router.get('/:id', verifyToken, checkRole(STAFF_RRHH_AMPLIO), personalController.obtenerEmpleado);
router.post('/registro', verifyToken, checkRole(STAFF_RRHH), personalController.registrarPersonal);
router.put('/:id', verifyToken, checkRole(STAFF_RRHH_AMPLIO), personalController.actualizarPersonal);

module.exports = router;