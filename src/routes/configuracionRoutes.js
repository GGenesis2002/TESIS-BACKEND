const express = require("express");
const router = express.Router();

// 1. Importación destructurada de los controladores
const { obtenerConfiguracion, actualizarConfiguracion } = require("../controllers/configuracionController");

// 2. Importación del middleware con el nombre exacto de tu archivo (verifyToken)
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');


// 3. Definición de Endpoints del Dispensario usando tu middleware real
router.get("/", verifyToken, obtenerConfiguracion);
router.put("/update", verifyToken, actualizarConfiguracion);

module.exports = router;