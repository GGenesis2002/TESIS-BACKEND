const axios = require('axios');

/**
 * Envía un correo vía Brevo.
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {Array<{ content: string, name: string }>} [attachments] - adjuntos en
 *   base64 (sin el prefijo "data:..."), p.ej. el PDF de un cierre de caja.
 */
const enviarCorreo = async (to, subject, html, attachments = []) => {
    try {
        const body = {
            sender: {
                name: "Laboratorio Clínico Garófalo",
                email: process.env.EMAIL_FROM
            },
            to: [
                {
                    email: to
                }
            ],
            subject: subject,
            htmlContent: html
        };

        if (Array.isArray(attachments) && attachments.length > 0) {
            body.attachment = attachments.map(a => ({ content: a.content, name: a.name }));
        }

        await axios.post('https://api.brevo.com/v3/smtp/email', body, {
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log("📧 Correo enviado correctamente (Brevo API)");
        return true;

    } catch (error) {
        console.error("❌ Error enviando correo:", error.response?.data || error.message);
        return false;
    }
};

module.exports = { enviarCorreo };