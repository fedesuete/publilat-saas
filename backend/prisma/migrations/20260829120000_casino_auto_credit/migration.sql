-- Acreditación automática (modelo B) POR CUENTA, para poder tener clientes automáticos y manuales a
-- la vez. Hoy el gate es GLOBAL (CHAT_PAY_WEBHOOK_SECRET en el .env): con el secreto puesto, TODA
-- cuenta con casino queda en auto y se apaga el /credit del approve manual. Eso no escala al dar de
-- alta clientes nuevos que todavía no tienen la recaudadora lista.
-- Aditiva y sin efecto por defecto: NULL = seguir decidiendo como hasta ahora (el global).
ALTER TABLE "User" ADD COLUMN "casinoAutoCredit" BOOLEAN;
