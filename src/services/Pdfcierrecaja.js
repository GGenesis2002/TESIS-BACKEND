const PDFDocument = require('pdfkit');

// Requiere la dependencia "pdfkit" en package.json:
//   npm install pdfkit

const ORANGE = '#E88B3A';
const DARK   = '#1F2937';
const GRAY   = '#6B7280';
const GREEN  = '#10B981';
const BLUE   = '#3B82F6';
const RED    = '#EF4444';

const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const fechaEC = (f) => f ? new Date(f).toLocaleString('es-EC', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';

// Mismo algoritmo (checksum no criptográfico) que usa el frontend en
// Modulocaja.jsx, para que el código impreso en el PDF coincida con el que
// muestra el sistema para ese mismo cierre.
const codigoVerificacion = (cierre) => {
    const base = `${cierre.id_cierre}|${cierre.efectivo_esperado}|${cierre.efectivo_contado}|${cierre.total_efectivo_sistema}|${cierre.total_transferencia_sistema}|${cierre.fecha_cierre}`;
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
        hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
    }
    return `CC-${hash.toString(16).toUpperCase().padStart(8, '0')}`;
};

/**
 * Genera el PDF del reporte de cierre de caja a partir del mismo objeto que
 * devuelve cajaModule.obtenerDetalleCierre: { cierre, pagos, reembolsos }.
 * Devuelve una Promise<Buffer> con el PDF ya armado.
 *
 * NOTA: los reembolsos solo se procesan en Efectivo (ver estadoInicialReembolso
 * en Modulocaja.jsx), por lo que este reporte solo incluye una tabla de
 * reembolsos en efectivo. No se agrega una tabla de "reembolsos por
 * transferencia" porque ese caso no puede darse en el sistema.
 */
function generarPdfCierre({ cierre, pagos, reembolsos }) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const dif = parseFloat(cierre.diferencia || 0);
        const cuadrado = Math.abs(dif) < 0.01;
        const colorDif = cuadrado ? GREEN : (dif > 0 ? BLUE : RED);
        const codigo = codigoVerificacion(cierre);

        // ── Encabezado ──
        doc.fontSize(15).fillColor(DARK).font('Helvetica-Bold')
            .text('LABORATORIO CLÍNICO CARDENAS-GAROFALO');
        doc.fontSize(10).fillColor(GRAY).font('Helvetica')
            .text('Reporte de Cierre de Caja');
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor(GRAY)
            .text(`Cierre N° ${cierre.id_cierre}   ·   Generado: ${fechaEC(new Date())}`);
        doc.moveTo(40, doc.y + 6).lineTo(572, doc.y + 6).strokeColor('#1D4ED8').lineWidth(2).stroke();
        doc.moveDown(1);

        // ── Datos del turno ──
        doc.fontSize(10).fillColor(DARK).font('Helvetica');
        doc.text(`Secretaria responsable: ${cierre.nombres || ''} ${cierre.apellidos || ''}`.trim());
        doc.text(`Apertura del turno: ${fechaEC(cierre.fecha_apertura)}`);
        doc.text(`Cierre del turno: ${fechaEC(cierre.fecha_cierre)}`);
        doc.moveDown(0.8);

        // ── Resumen financiero ──
        seccionTitulo(doc, 'Resumen financiero');
        filaResumen(doc, 'Fondo inicial', fmt(cierre.monto_inicial));
        filaResumen(doc, '(+) Efectivo cobrado', fmt(cierre.total_efectivo_sistema));
        filaResumen(doc, '(+) Transferencia cobrada', fmt(cierre.total_transferencia_sistema));
        filaResumen(doc, '(−) Reembolsos efectivo', fmt(cierre.total_reembolsos_efectivo));
        filaResumen(doc, 'Efectivo esperado', fmt(cierre.efectivo_esperado), true);
        filaResumen(doc, 'Efectivo contado (arqueo físico)', fmt(cierre.efectivo_contado), true);
        filaResumen(
            doc,
            cuadrado ? 'CAJA CUADRADA' : (dif > 0 ? 'Sobrante' : 'Faltante'),
            cuadrado ? '$0.00' : fmt(Math.abs(dif)),
            true, colorDif
        );
        doc.moveDown(0.6);

        if (cierre.observaciones) {
            seccionTitulo(doc, 'Observaciones');
            doc.fontSize(9).fillColor(DARK).font('Helvetica').text(cierre.observaciones);
            doc.moveDown(0.6);
        }

        // ── Detalle de cobros ──
        const pagosEfectivo      = pagos.filter(p => (p.metodo_pago || '').includes('Efectivo'));
        const pagosTransferencia = pagos.filter(p => (p.metodo_pago || '').includes('Transferencia'));

        seccionTitulo(doc, `Detalle de cobros (${pagos.length})`);
        tablaCobros(doc, '💵 Efectivo', pagosEfectivo, GREEN);
        tablaCobros(doc, '🏧 Transferencia', pagosTransferencia, BLUE);

        // ── Detalle de reembolsos ──
        // Solo Efectivo: no existe la variante "reembolso por transferencia"
        // en el sistema (ver nota arriba).
        seccionTitulo(doc, `Detalle de reembolsos (${reembolsos.length})`);
        tablaReembolsos(doc, '💵 Efectivo', reembolsos, GREEN);

        // ── Firmas ──
        doc.moveDown(2);
        const y = doc.y;
        doc.fontSize(9).fillColor(DARK);
        doc.moveTo(40, y).lineTo(240, y).strokeColor('#111').lineWidth(1).stroke();
        doc.text('Firma de la secretaria/o responsable', 40, y + 4, { width: 200 });
        doc.moveTo(340, y).lineTo(540, y).strokeColor('#111').lineWidth(1).stroke();
        doc.text('Firma de supervisor/administrador', 340, y + 4, { width: 200 });

        doc.moveDown(2);
        doc.fontSize(8).fillColor(GRAY).text(
            `Código de verificación del documento: ${codigo} — generado a partir de los montos registrados en el sistema.`,
            { align: 'center' }
        );

        doc.end();
    });
}

// ── Helpers de layout ──

function seccionTitulo(doc, titulo) {
    doc.fontSize(10).fillColor(DARK).font('Helvetica-Bold').text(titulo.toUpperCase());
    doc.moveTo(40, doc.y + 2).lineTo(572, doc.y + 2).strokeColor('#D1D5DB').lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.font('Helvetica');
}

function filaResumen(doc, label, valor, bold = false, color = DARK) {
    doc.fontSize(9.5).fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica');
    const y = doc.y;
    doc.text(label, 40, y, { continued: false, width: 380 });
    doc.text(valor, 420, y, { width: 132, align: 'right' });
}

function tablaCobros(doc, titulo, lista, color) {
    const subtotal = lista.reduce((s, p) => s + parseFloat(p.monto || 0), 0);
    doc.fontSize(9.5).fillColor(color).font('Helvetica-Bold')
        .text(`${titulo} (${lista.length}) — Subtotal: ${fmt(subtotal)}`);
    doc.moveDown(0.15);

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold');
    const colX = { ticket: 40, paciente: 110, metodo: 300, monto: 400, hora: 480 };
    doc.text('Ticket', colX.ticket, doc.y, { continued: false });
    doc.text('Paciente', colX.paciente, doc.y - doc.currentLineHeight());
    doc.text('Método', colX.metodo, doc.y - doc.currentLineHeight());
    doc.text('Monto', colX.monto, doc.y - doc.currentLineHeight());
    doc.text('Hora', colX.hora, doc.y - doc.currentLineHeight());
    doc.moveDown(0.2);

    doc.font('Helvetica').fillColor(DARK);
    if (lista.length === 0) {
        doc.fontSize(8.5).fillColor('#9CA3AF').text('Sin cobros por este método');
    } else {
        lista.forEach(p => {
            const y = doc.y;
            doc.fontSize(8.5).fillColor(DARK);
            doc.text(String(p.numero_ticket || ''), colX.ticket, y, { width: 65 });
            doc.text(`${p.paciente_nombres || ''} ${p.paciente_apellidos || ''}`.trim(), colX.paciente, y, { width: 185 });
            doc.text(p.metodo_pago || '', colX.metodo, y, { width: 95 });
            doc.text(fmt(p.monto), colX.monto, y, { width: 75 });
            doc.text(
                p.fecha_pago ? new Date(p.fecha_pago).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '',
                colX.hora, y, { width: 60 }
            );
            doc.moveDown(0.3);
        });
    }
    doc.moveDown(0.4);
}

function tablaReembolsos(doc, titulo, lista, color) {
    const subtotal = lista.reduce((s, r) => s + parseFloat(r.monto || 0), 0);
    doc.fontSize(9.5).fillColor(color).font('Helvetica-Bold')
        .text(`${titulo} (${lista.length}) — Subtotal: -${fmt(subtotal).replace('$', '')}`);
    doc.moveDown(0.15);

    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold');
    const colX = { ticket: 40, motivo: 110, metodo: 380, monto: 470 };
    doc.text('Ticket', colX.ticket, doc.y, { continued: false });
    doc.text('Motivo', colX.motivo, doc.y - doc.currentLineHeight());
    doc.text('Método', colX.metodo, doc.y - doc.currentLineHeight());
    doc.text('Monto', colX.monto, doc.y - doc.currentLineHeight());
    doc.moveDown(0.2);

    doc.font('Helvetica').fillColor(DARK);
    if (lista.length === 0) {
        doc.fontSize(8.5).fillColor('#9CA3AF').text('Sin reembolsos en este turno');
    } else {
        lista.forEach(r => {
            const y = doc.y;
            doc.fontSize(8.5).fillColor(DARK);
            doc.text(String(r.numero_ticket || ''), colX.ticket, y, { width: 65 });
            doc.text(r.motivo || '', colX.motivo, y, { width: 260 });
            doc.text(r.metodo_reembolso || '', colX.metodo, y, { width: 85 });
            doc.fillColor(RED).text(`-${fmt(r.monto)}`, colX.monto, y, { width: 75 });
            doc.moveDown(0.3);
        });
    }
    doc.moveDown(0.4);
}

module.exports = { generarPdfCierre, codigoVerificacion };