const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pool = require('../config/db');

const reporteController = {
    generarResultadoPDF: async (req, res) => {
        const { id_orden } = req.params;
        const fileName = `resultado_${id_orden}.pdf`;
        const filePath = path.join(__dirname, `../../storage/pdf/${fileName}`);

        try {
            // 1. QUERY MAESTRO: Datos del paciente, resultados, rangos por perfil y firmas
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
            if (result.rows.length === 0) return res.status(404).json({ msg: "No se encontraron resultados" });

            const data = result.rows[0];
            const doc = new PDFDocument({ margin: 40, size: 'A4' });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // --- 2. GENERACIÓN DE CÓDIGO QR ---
            // El QR contiene la URL de validación o el ID de la orden
            const qrData = `https://tu-laboratorio.com/validar/${data.numero_ticket}`;
            const qrImage = await QRCode.toDataURL(qrData);

            // --- 3. DISEÑO: ENCABEZADO Y QR ---
            doc.fontSize(20).font('Helvetica-Bold').text('SEMEDICLAB', 40, 40);
            doc.fontSize(8).font('Helvetica').text('Laboratorio Clínico Especializado', 40, 60);
            doc.text('Guayaquil, Ecuador | Tel: (04) 2XXX-XXX', 40, 70);

            // Posicionamos el QR en la esquina superior derecha
            doc.image(qrImage, 480, 30, { width: 70 });
            doc.fontSize(7).text('Validar resultado', 485, 105);

            // --- 4. DATOS DEL PACIENTE ---
            doc.rect(40, 120, 520, 50).stroke();
            doc.fontSize(9)
               .font('Helvetica-Bold').text(`PACIENTE:`, 50, 130)
               .font('Helvetica').text(`${data.nombres} ${data.apellidos}`, 110, 130)
               .font('Helvetica-Bold').text(`CÉDULA:`, 50, 145)
               .font('Helvetica').text(`${data.cedula}`, 110, 145)
               .font('Helvetica-Bold').text(`GÉNERO:`, 50, 155)
               .font('Helvetica').text(`${data.genero}`, 110, 155)
               // Lado derecho del cuadro
               .font('Helvetica-Bold').text(`TICKET:`, 350, 130)
               .font('Helvetica').text(`${data.numero_ticket}`, 400, 130)
               .font('Helvetica-Bold').text(`EDAD:`, 350, 145)
               .font('Helvetica').text(`${data.edad} AÑOS`, 400, 145)
               .font('Helvetica-Bold').text(`FECHA:`, 350, 155)
               .font('Helvetica').text(`${new Date(data.fecha_orden).toLocaleDateString()}`, 400, 155);

            let y = 190;

            // --- 5. AGRUPACIÓN Y TABLA DE RESULTADOS ---
            const examenes = {};
            result.rows.forEach(r => {
                if (!examenes[r.nombre_examen]) {
                    examenes[r.nombre_examen] = { validador: r.validador_examen, items: [] };
                }
                examenes[r.nombre_examen].items.push(r);
            });

            for (const [nombre, info] of Object.entries(examenes)) {
                // Encabezado del Examen (Gris)
                doc.fillColor('#eeeeee').rect(40, y, 520, 15).fill().fillColor('black');
                doc.fontSize(9).font('Helvetica-Bold')
                   .text(nombre.toUpperCase(), 50, y + 3)
                   .font('Helvetica').fontSize(8)
                   .text(`Validado por: ${info.validador}`, 400, y + 3, { align: 'right', width: 150 });
                
                y += 25;

                // Cabecera de columnas
                doc.fontSize(8).font('Helvetica-Bold')
                   .text('PARÁMETRO', 50, y)
                   .text('RESULTADO', 200, y)
                   .text('UNIDADES', 320, y)
                   .text('RANGO REFERENCIA', 420, y);
                
                y += 12;
                doc.moveTo(40, y).lineTo(560, y).lineWidth(0.5).stroke();
                y += 10;

                // Filas de parámetros
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
                y += 15; // Espacio entre bloques de exámenes
            }

            // --- 6. FIRMA DIGITAL FINAL ---
            doc.moveDown(4);
            const firmaY = doc.y;

            // Estampar imagen de firma si existe
            if (data.firma_digital) {
                const imgFirmaPath = path.join(__dirname, `../../storage/firmas/${data.firma_digital}`);
                if (fs.existsSync(imgFirmaPath)) {
                    doc.image(imgFirmaPath, 380, firmaY - 50, { width: 120 });
                }
            }

            doc.moveTo(350, firmaY).lineTo(550, firmaY).lineWidth(1).stroke();
            doc.fontSize(9).font('Helvetica-Bold')
               .text(`${data.admin_nom} ${data.admin_ape}`, 350, firmaY + 5, { align: 'center', width: 200 })
               .font('Helvetica').fontSize(8).text(`${data.cargo || 'Responsable Técnico'}`, { align: 'center', width: 200 })
               .fillColor('blue').fontSize(7).text('FIRMADO ELECTRÓNICAMENTE', { align: 'center', width: 200 });

            doc.end();

            stream.on('finish', () => {
                res.download(filePath, fileName);
            });

        } catch (e) {
            console.error(e);
            res.status(500).json({ error: "Error al generar el PDF" });
        }
    }
};

module.exports = reporteController;