const axios = require('axios');

const enviarCorreo = async (to, subject, html) => {
    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
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
        }, {
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