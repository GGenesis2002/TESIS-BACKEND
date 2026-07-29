const express = require('express');
const router = express.Router();
const controller = require('../controllers/pacienteController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const PACIENTE_ONLY = [ROLES.PACIENTE];
const ROLES_PERMITIDOS =[ROLES.ADMIN, ROLES.TECNICO, ROLES.ESPECIALISTA, ROLES.ASISTENTE];

// Rutas públicas
router.post('/registro', controller.registrarPaciente);
// Verificación pública de cédula para el registro desde el app (sin datos personales)
router.get('/verificar-cedula/:cedula', controller.verificarCedulaPublico);

// Perfil propio (el paciente edita su cuenta desde el app)
router.get('/perfil',  verifyToken, checkRole(PACIENTE_ONLY),controller.obtenerPerfilPropio);
router.put('/perfil',  verifyToken,checkRole(PACIENTE_ONLY), controller.editarPerfilPropio);

// Rutas protegidas
router.get('/consultar-cedula/:cedula', verifyToken,checkRole(ROLES_PERMITIDOS), controller.consultarPorCedula);
router.get('/', verifyToken, checkRole(ROLES_PERMITIDOS),controller.listarPacientes);
router.put('/:id', verifyToken, checkRole(ROLES_PERMITIDOS ),controller.actualizarPaciente);
router.delete('/:id', verifyToken,checkRole(ROLES_PERMITIDOS), controller.desactivar);
router.get('/mis-resultados/:id_orden', verifyToken, checkRole(PACIENTE_ONLY, ROLES_PERMITIDOS),controller.verResultadosPaciente);
router.put('/reactivar/:id', verifyToken, checkRole(ROLES_PERMITIDOS),controller.reactivar);

module.exports = router;