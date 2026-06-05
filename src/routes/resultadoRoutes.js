const router  = require('express').Router();
const pool    = require('../config/db');
const multer  = require('multer');
const resultadoController = require('../controllers/resultadoController');
const { verifyToken } = require('../middlewares/authMiddleware');

// ── Multer para PDFs subidos por especialistas (exámenes tipo PDF) ──
const storagePDF = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './storage/pdf/'),
    filename:    (req, file, cb) =>
        cb(null, `esp_${req.body.id_resultado}_${Date.now()}.pdf`),
});
const uploadPDF = multer({
    storage: storagePDF,
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

// ── Multer para PDFs generados por el admin al validar ──
const storageOrden = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './storage/pdf/'),
    filename:    (req, file, cb) =>
        cb(null, `orden_${req.body.id_orden}_${Date.now()}.pdf`),
});
const uploadOrden = multer({
    storage: storageOrden,
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

// ── Especialista ──
router.post('/guardar-valor',          verifyToken, resultadoController.gestionarValor);
router.put('/enviar-revision/:id',     verifyToken, resultadoController.enviarRevisionV2);
router.get('/mis-ordenes',             verifyToken, resultadoController.misOrdenes);
router.get('/detalle-orden/:id_orden', verifyToken, resultadoController.detalleOrden);

// ── Subir PDF de examen (especialista) ──
router.post('/subir-pdf', verifyToken, uploadPDF.single('pdf'), async (req, res) => {
    try {
        const { id_resultado } = req.body;
        if (!req.file)
            return res.status(400).json({ error: "No se recibió ningún archivo PDF." });
        const pdf_url = `/storage/pdf/${req.file.filename}`;
        await pool.query(
            "UPDATE resultado SET archivo_pdf = $1 WHERE id_resultado = $2",
            [pdf_url, id_resultado]
        );
        res.json({ pdf_url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Subir PDF generado de una orden completa (admin) ──
router.post('/subir-pdf-orden', verifyToken, uploadOrden.single('pdf_orden'), async (req, res) => {
    try {
        const { id_orden } = req.body;
        if (!req.file)
            return res.status(400).json({ error: "No se recibió ningún archivo PDF." });
        const pdf_url = `/storage/pdf/${req.file.filename}`;
        // Guardar URL en todos los resultados de esta orden
        await pool.query(
            "UPDATE resultado SET archivo_pdf = $1 WHERE id_orden = $2",
            [pdf_url, id_orden]
        );
        res.json({ pdf_url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Admin ──
router.get('/admin/ordenes',                       verifyToken, resultadoController.ordenesParaAdmin);
router.get('/admin/orden/:id_orden',               verifyToken, resultadoController.detalleOrdenAdmin);
router.put('/devolver/:id_resultado',              verifyToken, resultadoController.devolverEspecialista);
router.put('/devolver-parametro/:id_detalle',      verifyToken, resultadoController.devolverParametro);
router.put('/publicar/:id_resultado',              verifyToken, resultadoController.publicarFinal);

module.exports = router;