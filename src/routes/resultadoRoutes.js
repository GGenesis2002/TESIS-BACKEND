const router    = require('express').Router();
const pool      = require('../config/db');
const multer    = require('multer');
const supabase  = require('../config/supabaseStorage'); // ← tu cliente ya existente
const resultadoController = require('../controllers/resultadoController');
const { verifyToken } = require('../middlewares/authMiddleware');

const BUCKET = process.env.SUPABASE_BUCKET || 'pdfs';

// ── Multer en memoria para PDFs (distinto al multer.js de imágenes) ──
const uploadPDF = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// ── Helper: sube buffer a Supabase y devuelve la URL pública ──
async function subirPDFaSupabase(buffer, fileName) {
    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, buffer, { contentType: 'application/pdf', upsert: true });

    if (error) throw new Error(`Supabase Storage: ${error.message}`);

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
}

// ── Especialista ──
router.post('/guardar-valor',          verifyToken, resultadoController.gestionarValor);
router.put('/enviar-revision/:id',     verifyToken, resultadoController.enviarRevisionV2);
router.get('/mis-ordenes',             verifyToken, resultadoController.misOrdenes);
router.get('/detalle-orden/:id_orden', verifyToken, resultadoController.detalleOrden);

// ── Subir PDF de examen (especialista) → Supabase Storage ──
router.post('/subir-pdf', verifyToken, uploadPDF.single('pdf'), async (req, res) => {
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
        res.status(500).json({ error: e.message });
    }
});

// ── Subir PDF de orden completa (admin) → Supabase Storage ──
router.post('/subir-pdf-orden', verifyToken, uploadPDF.single('pdf_orden'), async (req, res) => {
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
        res.status(500).json({ error: e.message });
    }
});

// ── Admin ──
router.get('/admin/ordenes',                  verifyToken, resultadoController.ordenesParaAdmin);
router.get('/admin/orden/:id_orden',          verifyToken, resultadoController.detalleOrdenAdmin);
router.put('/devolver/:id_resultado',         verifyToken, resultadoController.devolverEspecialista);
router.put('/devolver-parametro/:id_detalle', verifyToken, resultadoController.devolverParametro);
router.put('/publicar/:id_resultado',         verifyToken, resultadoController.publicarFinal);

router.get('/paciente/ordenes',              verifyToken, resultadoController.ordenesDelPaciente);
router.get('/paciente/orden/:id_orden',      verifyToken, resultadoController.detalleOrdenPaciente);
module.exports = router;