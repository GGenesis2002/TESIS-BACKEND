const PDFDocument = require('pdfkit');

// Requiere la dependencia "pdfkit" en package.json:
//   npm install pdfkit

// ── Paleta (misma que ConfiguracionSistema.jsx / Modulocaja.jsx) ──
const ORANGE   = '#E88B3A';
const DARK     = '#1F2937';
const GRAY     = '#6B7280';
const GRAY_LT  = '#9CA3AF';
const BG_SOFT  = '#F8FAFC';
const BORDER   = '#F1F5F9';
const GREEN    = '#10B981';
const BLUE     = '#3B82F6';
const RED      = '#EF4444';

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

const PAGE_LEFT  = 40;
const PAGE_RIGHT = 572;

/**
 * Genera el PDF del reporte de cierre de caja a partir del mismo objeto que
 * devuelve cajaModule.obtenerDetalleCierre: { cierre, pagos, reembolsos }.
 * Devuelve una Promise<Buffer> con el PDF ya armado.
 *
 * NOTA: los reembolsos solo se procesan en Efectivo (ver estadoInicialReembolso
 * en Modulocaja.jsx), por lo que este reporte solo incluye una tabla de
 * reembolsos en efectivo. No existe la variante "reembolso por transferencia"
 * en el sistema.
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
            .text('LABORATORIO CLINICO CARDENAS-GAROFALO');
        doc.fontSize(10).fillColor(GRAY).font('Helvetica')
            .text('Reporte de Cierre de Caja');
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor(GRAY)
            .text(`Cierre N. ${cierre.id_cierre}   -   Generado: ${fechaEC(new Date())}`);
        doc.moveTo(PAGE_LEFT, doc.y + 6).lineTo(PAGE_RIGHT, doc.y + 6).strokeColor(ORANGE).lineWidth(2).stroke();
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
        filaResumen(doc, '(-) Reembolsos efectivo', fmt(cierre.total_reembolsos_efectivo));
        filaResumen(doc, 'Efectivo esperado', fmt(cierre.efectivo_esperado), true);
        filaResumen(doc, 'Efectivo contado (arqueo fisico)', fmt(cierre.efectivo_contado), true);
        filaResumen(
            doc,
            cuadrado ? 'CAJA CUADRADA' : (dif > 0 ? 'Sobrante' : 'Faltante'),
            cuadrado ? '$0.00' : fmt(Math.abs(dif)),
            true, colorDif
        );
        doc.moveDown(0.6);

        if (cierre.observaciones) {
            seccionTitulo(doc, 'Observaciones');
            doc.fontSize(9).fillColor(DARK).font('Helvetica').text(cierre.observaciones, PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT });
            doc.moveDown(0.6);
        }

        // ── Detalle de cobros ──
        const pagosEfectivo      = pagos.filter(p => (p.metodo_pago || '').includes('Efectivo'));
        const pagosTransferencia = pagos.filter(p => (p.metodo_pago || '').includes('Transferencia'));

        seccionTitulo(doc, `Detalle de cobros (${pagos.length})`);
        tablaCobros(doc, 'Efectivo', pagosEfectivo, GREEN);
        tablaCobros(doc, 'Transferencia', pagosTransferencia, BLUE);

        // ── Detalle de reembolsos ──
        // Solo Efectivo: no existe la variante "reembolso por transferencia"
        // en el sistema (ver nota arriba).
        seccionTitulo(doc, `Detalle de reembolsos (${reembolsos.length})`);
        tablaReembolsos(doc, 'Efectivo', reembolsos, GREEN);

        // ── Firmas ──
        asegurarEspacio(doc, 70);
        doc.moveDown(1.5);
        const yFirma = doc.y;
        doc.fontSize(9).fillColor(DARK);
        doc.moveTo(PAGE_LEFT, yFirma).lineTo(240, yFirma).strokeColor(DARK).lineWidth(1).stroke();
        doc.text('Firma de la secretaria/o responsable', PAGE_LEFT, yFirma + 4, { width: 200 });
        doc.moveTo(340, yFirma).lineTo(PAGE_RIGHT, yFirma).strokeColor(DARK).lineWidth(1).stroke();
        doc.text('Firma de supervisor/administrador', 340, yFirma + 4, { width: 200 });

        doc.moveDown(2.2);
        doc.fontSize(8).fillColor(GRAY_LT).text(
            `Codigo de verificacion del documento: ${codigo} - generado a partir de los montos registrados en el sistema.`,
            PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT, align: 'center' }
        );

        doc.end();
    });
}

// ── Helpers de layout ──

// Salta de página si no queda suficiente espacio para lo siguiente, para
// evitar que una tabla o fila quede cortada a la mitad entre dos hojas.
function asegurarEspacio(doc, alturaNecesaria) {
    if (doc.y + alturaNecesaria > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
    }
}

function seccionTitulo(doc, titulo) {
    asegurarEspacio(doc, 40);
    // Barra de fondo suave + texto en mayúsculas, igual estilo que
    // sectionTitle en ConfiguracionSistema.jsx (fondo #F8FAFC, texto gris).
    const y = doc.y;
    doc.rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 18).fill(BG_SOFT);
    doc.fillColor(GRAY).fontSize(9).font('Helvetica-Bold')
        .text(titulo.toUpperCase(), PAGE_LEFT + 6, y + 4.5, { width: PAGE_RIGHT - PAGE_LEFT - 12, characterSpacing: 0.5 });
    doc.y = y + 18;
    doc.moveDown(0.4);
    doc.font('Helvetica');
}

function filaResumen(doc, label, valor, bold = false, color = DARK) {
    asegurarEspacio(doc, 16);
    const y = doc.y;
    doc.fontSize(9.5).fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(label, PAGE_LEFT, y, { width: 340 });
    doc.text(valor, 420, y, { width: PAGE_RIGHT - 420, align: 'right' });
    doc.y = y + 15;
}

// Dibuja el encabezado de una tabla en una sola fila (misma "y" para todas
// las columnas), evitando que el texto se pise entre sí.
function encabezadoTabla(doc, columnas) {
    asegurarEspacio(doc, 16);
    const y = doc.y;
    doc.fontSize(8).fillColor(GRAY).font('Helvetica-Bold');
    columnas.forEach(({ texto, x, width, align }) => {
        doc.text(texto, x, y, { width, align: align || 'left' });
    });
    doc.y = y + 13;
    doc.moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_RIGHT, doc.y).strokeColor(BORDER).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica');
}

function tablaCobros(doc, titulo, lista, color) {
    const subtotal = lista.reduce((s, p) => s + parseFloat(p.monto || 0), 0);
    asegurarEspacio(doc, 30);
    doc.fontSize(9.5).fillColor(color).font('Helvetica-Bold')
        .text(`${titulo} (${lista.length}) - Subtotal: ${fmt(subtotal)}`, PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT });
    doc.moveDown(0.25);

    const colX = { ticket: 40, paciente: 105, metodo: 300, monto: 400, hora: 480 };
    encabezadoTabla(doc, [
        { texto: 'Ticket',   x: colX.ticket,   width: 60 },
        { texto: 'Paciente', x: colX.paciente, width: 190 },
        { texto: 'Metodo',   x: colX.metodo,   width: 95 },
        { texto: 'Monto',    x: colX.monto,    width: 75, align: 'right' },
        { texto: 'Hora',     x: colX.hora,     width: 60 },
    ]);

    if (lista.length === 0) {
        doc.fontSize(8.5).fillColor(GRAY_LT).text('Sin cobros por este metodo', PAGE_LEFT, doc.y);
        doc.moveDown(0.3);
    } else {
        lista.forEach(p => {
            asegurarEspacio(doc, 14);
            const y = doc.y;
            doc.fontSize(8.5).fillColor(DARK);
            doc.text(String(p.numero_ticket || ''), colX.ticket, y, { width: 60 });
            doc.text(`${p.paciente_nombres || ''} ${p.paciente_apellidos || ''}`.trim(), colX.paciente, y, { width: 190 });
            doc.text(p.metodo_pago || '', colX.metodo, y, { width: 95 });
            doc.text(fmt(p.monto), colX.monto, y, { width: 75, align: 'right' });
            doc.text(
                p.fecha_pago ? new Date(p.fecha_pago).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }) : '',
                colX.hora, y, { width: 60 }
            );
            doc.y = y + 14;
        });
    }
    doc.moveDown(0.5);
}

function tablaReembolsos(doc, titulo, lista, color) {
    const subtotal = lista.reduce((s, r) => s + parseFloat(r.monto || 0), 0);
    asegurarEspacio(doc, 30);
    doc.fontSize(9.5).fillColor(color).font('Helvetica-Bold')
        .text(`${titulo} (${lista.length}) - Subtotal: -${fmt(subtotal).replace('$', '')}`, PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT });
    doc.moveDown(0.25);

    const colX = { ticket: 40, motivo: 105, metodo: 380, monto: 470 };
    encabezadoTabla(doc, [
        { texto: 'Ticket',  x: colX.ticket, width: 60 },
        { texto: 'Motivo',  x: colX.motivo, width: 265 },
        { texto: 'Metodo',  x: colX.metodo, width: 85 },
        { texto: 'Monto',   x: colX.monto,  width: 62, align: 'right' },
    ]);

    if (lista.length === 0) {
        doc.fontSize(8.5).fillColor(GRAY_LT).text('Sin reembolsos en este turno', PAGE_LEFT, doc.y);
        doc.moveDown(0.3);
    } else {
        lista.forEach(r => {
            asegurarEspacio(doc, 14);
            const y = doc.y;
            doc.fontSize(8.5).fillColor(DARK);
            doc.text(String(r.numero_ticket || ''), colX.ticket, y, { width: 60 });
            doc.text(r.motivo || '', colX.motivo, y, { width: 265 });
            doc.text(r.metodo_reembolso || '', colX.metodo, y, { width: 85 });
            doc.fillColor(RED).text(`-${fmt(r.monto)}`, colX.monto, y, { width: 62, align: 'right' });
            doc.y = y + 14;
        });
    }
    doc.moveDown(0.5);
}

module.exports = { generarPdfCierre, codigoVerificacion };