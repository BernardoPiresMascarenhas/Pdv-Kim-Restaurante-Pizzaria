'use server';

export type PerfilUsuario = 'admin' | 'garcom';

/** Confere a senha no servidor e devolve só o perfil.
 *
 *  As senhas ficam em SENHA_ADMIN / SENHA_GARCOM, sem o prefixo
 *  NEXT_PUBLIC_: assim elas nunca entram no bundle que vai pro navegador.
 *  O retorno é só o perfil, nunca a senha em si. */
export async function autenticar(senha: unknown): Promise<PerfilUsuario | null> {
  if (typeof senha !== 'string' || senha.length === 0) return null;

  const senhaAdmin = process.env.SENHA_ADMIN;
  const senhaGarcom = process.env.SENHA_GARCOM;

  // Sem a variável configurada nada autentica: melhor travar do que
  // deixar entrar com senha vazia por descuido de configuração.
  if (senhaAdmin && senha === senhaAdmin) return 'admin';
  if (senhaGarcom && senha === senhaGarcom) return 'garcom';

  return null;
}
