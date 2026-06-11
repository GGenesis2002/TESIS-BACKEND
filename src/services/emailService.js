const nodemailer = require('nodemailer');



const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    family: 4,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

transporter.verify((error, success) => {
    if (error) {
        console.error('SMTP VERIFY ERROR:', error);
    } else {
        console.log('SMTP READY');
    }
});

const enviarCorreo = async (to, subject, html) => {
    try {
        console.log("Intentando enviar correo a:", to);

        await transporter.sendMail({
            from: `"Laboratorio Clínico 🔬" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });

        console.log("Correo enviado");
        return true;

    } catch (error) {
        console.error("Error al enviar correo:", error);
        return false;
    }
};

module.exports = { enviarCorreo };