const express = require("express");
const router = express.Router();

// 1. Importación destructurada de los controladores
const { obtenerConfiguracion, actualizarConfiguracion } = require("../controllers/configuracionController");

// 2. Importación del middleware
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const CONF_TECNICO = [ROLES.TECNICO];

// 3. Definición de Endpoints del Dispensario 
router.get("/", verifyToken,checkRole(CONF_TECNICO),  obtenerConfiguracion);
router.put("/update", verifyToken, checkRole(CONF_TECNICO),actualizarConfiguracion);

module.exports = router;