/**
 * Regra de elegibilidade para cadastro de profissional (perfil de staff).
 *
 * Usuário ATIVO com QUALQUER cargo pode virar profissional — não existe
 * lista branca de nomes de cargo. A regra vive isolada (sem Prisma) para ser
 * testável em gate e reutilizada pela listagem unificada — evita drift entre
 * "quem aparece" e "quem pode ser criado".
 */
export interface StaffCandidateUser {
  isActive: boolean;
  roleId?: string | null;
  role?: { name: string } | null;
}

/**
 * Verdadeiro se o usuário pode receber perfil de staff:
 * existe, está ativo e tem cargo (roleId ou role — qualquer nome).
 */
export function isStaffProfileEligible(user: StaffCandidateUser | null | undefined): boolean {
  if (!user) return false;
  if (!user.isActive) return false;
  if (!user.roleId && !user.role) return false;
  return true;
}

/**
 * Lança Error com mensagem legível se o usuário não puder receber perfil de staff.
 */
export function assertStaffProfileEligibility(user: StaffCandidateUser | null | undefined): void {
  if (!user) {
    throw new Error('Usuário não encontrado');
  }

  if (!user.isActive) {
    throw new Error('Usuário inativo não pode ser cadastrado como profissional');
  }

  if (!user.roleId && !user.role) {
    throw new Error('Usuário sem cargo não pode ser cadastrado como profissional');
  }
}
