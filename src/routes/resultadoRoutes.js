const router    = require('express').Router();
const pool      = require('../config/db');
const multer    = require('multer');
const supabase  = require('../config/supabaseStorage');
const resultadoController = require('../controllers/resultadoController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');
const ROLES = require('../config/roles');

const BUCKET = process.env.SUPABASE_BUCKET || 'pdfs';

const uploadPDF = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

async function subirPDFaSupabase(buffer, fileName) {
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, buffer, { contentType: 'application/pdf', upsert: true });

    if (error) throw new Error(`Supabase Storage: ${error.message}`);

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
}

// "Ingreso y firma de resultados de los exámenes asignados" → Especialista
const ESPECIALISTA_ONLY = [ROLES.ESPECIALISTA];
// "Validación de resultados médicos" → Administrador
const ADMIN_ONLY = [ROLES.ADMIN];
const PACIENTE_ONLY = [ROLES.PACIENTE];

// ── Especialista ──
router.post('/guardar-valor',          verifyToken, checkRole(ESPECIALISTA_ONLY), resultadoController.gestionarValor);
router.put('/enviar-revision/:id',     verifyToken, checkRole(ESPECIALISTA_ONLY), resultadoController.enviarRevisionV2);
router.get('/mis-ordenes',             verifyToken, checkRole(ESPECIALISTA_ONLY), resultadoController.misOrdenes);
router.get('/detalle-orden/:id_orden', verifyToken, checkRole(ESPECIALISTA_ONLY), resultadoController.detalleOrden);

// ── Subir PDF de examen (especialista) → Supabase Storage ──
router.post('/subir-pdf', verifyToken, checkRole(ESPECIALISTA_ONLY), uploadPDF.single('pdf'), async (req, res) => {
    try {
        const { id_resultado } = req.body;
        if (!req.file)
            return res.status(400).json({ error: 'No se recibió ningún archivo PDF.' });

        const fileName = `esp_${id_resultado}_${Date.now()}.pdf`;
        const pdf_url  = await subirPDFaSupabase(req.file.buffer, fileName);

        await pool.query(
            'UPDATE resultado SET archivo_pdf = $1 WHERE id_resultado = $2',
            [pdf_url, id_resultado]
        );

        res.json({ pdf_url });
    } catch (e) {
        console.error('❌ /subir-pdf:', e.message);
        res.status(500).json({ error: 'No se pudo procesar el archivo.' }); // sin filtrar detalle interno
    }
});

// ── Subir PDF de orden completa (admin) → Supabase Storage ──
router.post('/subir-pdf-orden', verifyToken, checkRole(ADMIN_ONLY), uploadPDF.single('pdf_orden'), async (req, res) => {
    try {
        const { id_orden } = req.body;
        if (!req.file)
            return res.status(400).json({ error: 'No se recibió ningún archivo PDF.' });

        const fileName = `orden_${id_orden}_${Date.now()}.pdf`;
        const pdf_url  = await subirPDFaSupabase(req.file.buffer, fileName);

        await pool.query(
            'UPDATE resultado SET archivo_pdf = $1 WHERE id_orden = $2',
            [pdf_url, id_orden]
        );

        res.json({ pdf_url });
    } catch (e) {
        console.error('❌ /subir-pdf-orden:', e.message);
        res.status(500).json({ error: 'No se pudo procesar el archivo.' });
    }
});

// ── Admin ──
router.get('/admin/ordenes',                  verifyToken, checkRole(ADMIN_ONLY), resultadoController.ordenesParaAdmin);
router.get('/admin/orden/:id_orden',          verifyToken, checkRole(ADMIN_ONLY), resultadoController.detalleOrdenAdmin);
router.put('/devolver/:id_resultado',         verifyToken, checkRole(ADMIN_ONLY), resultadoController.devolverEspecialista);
router.put('/devolver-parametro/:id_detalle', verifyToken, checkRole(ADMIN_ONLY), resultadoController.devolverParametro);
router.put('/publicar/:id_resultado',         verifyToken, checkRole(ADMIN_ONLY), resultadoController.publicarFinal);

// ── Paciente ──

router.get('/paciente/ordenes',              verifyToken, checkRole(PACIENTE_ONLY), resultadoController.ordenesDelPaciente);
router.get('/paciente/orden/:id_orden',      verifyToken, checkRole(PACIENTE_ONLY), resultadoController.detalleOrdenPaciente);

module.exports = router;