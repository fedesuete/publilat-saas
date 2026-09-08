-- Minimos del cajero POR CUENTA (null = los del sistema: carga 2000 / retiro 5000).
ALTER TABLE "User" ADD COLUMN "chatMinDeposit" INTEGER;
ALTER TABLE "User" ADD COLUMN "chatMinWithdrawal" INTEGER;
