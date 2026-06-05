const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const pool = require('../config/db');
const supabase = require('../config/supabaseStorage');

const reporteController = {

    // ── Genera el PDF, lo sube a Supabase Storage y devuelve la URL firmada ──
    generarResultadoPDF: async (req, res) => {
        const { id_orden } = req.params;
        try {
            const { url, fileName } = await reporteController.generarArchivoFisicoPDF(id_orden);

            // URL firmada válida por 1 hora para descarga directa
            const { data: signed, error: signError } = await supabase.storage
                .from('pdfs')
                .createSignedUrl(fileName, 3600);

            if (signError) throw new Error('Error generando URL: ' + signError.message);

            res.json({ url: signed.signedUrl, fileName });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Error al generar el PDF: " + e.message });
        }
    },

    // ── Genera el PDF en memoria y lo sube a Supabase Storage ──────────────
    // Usado internamente por validacionController.gestionarValidacion
    generarArchivoFisicoPDF: async (id_orden) => {
        const query = `
            SELECT o.id_orden, o.numero_ticket, o.fecha_orden, o.qr_codigo,
                   u.nombres, u.apellidos, u.cedula,
                   p.genero, EXTRACT(YEAR FROM AGE(p.fecha_nacimiento)) as edad,
                   adm.firma_digital, adm.cargo,
                   val_u.nombres as admin_nom, val_u.apellidos as admin_ape,
                   e.nombre_examen, pe.nombre_parametro, dr.valor_obtenido, 
                   pe.unidad, pe.rango_min, pe.rango_max, pe.valor_referencia,
                   esp_u.username as validador_examen
            FROM orden_medica o
            JOIN paciente p ON o.id_paciente = p.id_paciente
            JOIN usuario u ON p.id_usuario = u.id_usuario
            JOIN resultado r ON o.id_orden = r.id_orden
            JOIN detalle_resultado dr ON r.id_resultado = dr.id_resultado
            JOIN parametro_examen pe ON dr.id_parametro = pe.id_parametro
            JOIN examen e ON pe.id_examen = e.id_examen
            LEFT JOIN especialista esp ON r.id_especialista = esp.id_especialista
            LEFT JOIN usuario esp_u ON esp.id_usuario = esp_u.id_usuario
            LEFT JOIN administrador adm ON o.id_validador = adm.id_usuario
            LEFT JOIN usuario val_u ON adm.id_usuario = val_u.id_usuario
            WHERE o.id_orden = $1 
            AND (pe.sexo_referencia = p.genero OR pe.sexo_referencia = 'General')
            AND (EXTRACT(YEAR FROM AGE(p.fecha_nacimiento)) BETWEEN pe.edad_min AND pe.edad_max)
            ORDER BY e.nombre_examen;
        `;

        const result = await pool.query(query, [id_orden]);
        if (result.rows.length === 0) throw new Error("No se encontraron resultados para la orden " + id_orden);

        const data = result.rows[0];

        // ── Construir PDF en memoria (buffer) ────────────────────────────────
        const pdfBuffer = await new Promise(async (resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 40, size: 'A4' });
                const chunks = [];
                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                // QR
                const qrData = `https://tu-laboratorio.com/validar/${data.numero_ticket}`;
                const qrImage = await QRCode.toDataURL(qrData);

                // Encabezado
                doc.fontSize(20).font('Helvetica-Bold').text('SEMEDICLAB', 40, 40);
                doc.fontSize(8).font('Helvetica').text('Laboratorio Clínico Especializado', 40, 60);
                doc.text('Guayaquil, Ecuador | Tel: (04) 2XXX-XXX', 40, 70);
                doc.image(qrImage, 480, 30, { width: 70 });
                doc.fontSize(7).text('Validar resultado', 485, 105);

                // Datos del paciente
                doc.rect(40, 120, 520, 50).stroke();
                doc.fontSize(9)
                   .font('Helvetica-Bold').text('PACIENTE:', 50, 130)
                   .font('Helvetica').text(`${data.nombres} ${data.apellidos}`, 110, 130)
                   .font('Helvetica-Bold').text('CÉDULA:', 50, 145)
                   .font('Helvetica').text(`${data.cedula}`, 110, 145)
                   .font('Helvetica-Bold').text('GÉNERO:', 50, 155)
                   .font('Helvetica').text(`${data.genero}`, 110, 155)
                   .font('Helvetica-Bold').text('TICKET:', 350, 130)
                   .font('Helvetica').text(`${data.numero_ticket}`, 400, 130)
                   .font('Helvetica-Bold').text('EDAD:', 350, 145)
                   .font('Helvetica').text(`${data.edad} AÑOS`, 400, 145)
                   .font('Helvetica-Bold').text('FECHA:', 350, 155)
                   .font('Helvetica').text(`${new Date(data.fecha_orden).toLocaleDateString()}`, 400, 155);

                let y = 190;

                // Tabla de resultados agrupada por examen
                const examenes = {};
                result.rows.forEach(r => {
                    if (!examenes[r.nombre_examen]) {
                        examenes[r.nombre_examen] = { validador: r.validador_examen, items: [] };
                    }
                    examenes[r.nombre_examen].items.push(r);
                });

                for (const [nombre, info] of Object.entries(examenes)) {
                    doc.fillColor('#eeeeee').rect(40, y, 520, 15).fill().fillColor('black');
                    doc.fontSize(9).font('Helvetica-Bold')
                       .text(nombre.toUpperCase(), 50, y + 3)
                       .font('Helvetica').fontSize(8)
                       .text(`Validado por: ${info.validador}`, 400, y + 3, { align: 'right', width: 150 });
                    y += 25;

                    doc.fontSize(8).font('Helvetica-Bold')
                       .text('PARÁMETRO', 50, y)
                       .text('RESULTADO', 200, y)
                       .text('UNIDADES', 320, y)
                       .text('RANGO REFERENCIA', 420, y);
                    y += 12;
                    doc.moveTo(40, y).lineTo(560, y).lineWidth(0.5).stroke();
                    y += 10;

                    info.items.forEach(p => {
                        const ref = p.rango_min ? `${p.rango_min} - ${p.rango_max}` : (p.valor_referencia || 'N/A');
                        doc.fontSize(8).font('Helvetica')
                           .text(p.nombre_parametro, 50, y)
                           .font('Helvetica-Bold').text(p.valor_obtenido, 200, y)
                           .font('Helvetica').text(p.unidad || '', 320, y)
                           .text(ref, 420, y);
                        y += 15;
                        if (y > 720) { doc.addPage(); y = 50; }
                    });
                    y += 15;
                }

                // Firma digital — descargar desde Supabase Storage si existe
                if (data.firma_digital) {
                    const { data: firmaData, error: firmaError } = await supabase.storage
                        .from('firmas')
                        .download(data.firma_digital);

                    if (!firmaError && firmaData) {
                        const firmaBuffer = Buffer.from(await firmaData.arrayBuffer());
                        const firmaY = y + 20;
                        doc.image(firmaBuffer, 380, firmaY - 50, { width: 120 });
                        doc.moveTo(350, firmaY).lineTo(550, firmaY).lineWidth(1).stroke();
                        doc.fontSize(9).font('Helvetica-Bold')
                           .text(`${data.admin_nom} ${data.admin_ape}`, 350, firmaY + 5, { align: 'center', width: 200 })
                           .font('Helvetica').fontSize(8)
                           .text(`${data.cargo || 'Responsable Técnico'}`, { align: 'center', width: 200 })
                           .fillColor('blue').fontSize(7)
                           .text('FIRMADO ELECTRÓNICAMENTE', { align: 'center', width: 200 });
                    }
                }

                doc.end();
            } catch (err) {
                reject(err);
            }
        });

        // ── Subir buffer a Supabase Storage ──────────────────────────────────
        const fileName = `resultado_${id_orden}.pdf`;

        const { error: uploadError } = await supabase.storage
            .from('pdfs')
            .upload(fileName, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true  // sobreescribe si ya existe
            });

        if (uploadError) throw new Error('Error subiendo PDF: ' + uploadError.message);

        // Guardar la ruta en la BD para referencia futura
        await pool.query(
            `UPDATE resultado SET archivo_pdf = $1 WHERE id_orden = $2`,
            [fileName, id_orden]
        );

        return { fileName, url: fileName };
    }
};

module.exports = reporteController;