// Gate estático: contrato frontend da feature "lista de Profissionais".
//
// Por que existe: os fixes da ALTA (atribuição de cargo) e da BAIXA (botão
// "Completar cadastro" só com staff.create) ficaram sem cobertura automatizada.
//
// Por que AST e não regex (fix do achado BAIXA do review 2026-11-15):
//   Regex de presença passa com código quebrado — `POST` sem `{ roleId }`,
//   `canCompleteRegistration = mounted` sem combinar `canCreateStaff`, ou
//   `hasProfile !== false` só num comentário. Aqui a afirmação é sobre a
//   ESTRUTURA do código: chamada, argumentos, condição e operador.
//
// É análise estática de arquivo — não executa a aplicação e não toca no banco.
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, '..', '..', 'frontend', 'src');

let fails = 0;
const pass = (ok, label, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` | ${extra}` : ''}`);
};

function parse(rel) {
  const path = resolve(FRONTEND, rel);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  return { source, text };
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

const findAll = (source, predicate) => {
  const hits = [];
  walk(source, (node) => {
    if (predicate(node)) hits.push(node);
  });
  return hits;
};

const isIdentifier = (node, name) =>
  ts.isIdentifier(node) && node.text === name;

const isStringLiteral = (node, text) =>
  ts.isStringLiteral(node) && node.text === text;

/** Texto de um template literal: ex.: "/staff/${staffId}/assign-role" */
const templateText = (node) => {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    node.templateSpans.forEach((span) => {
      text += `\${${span.expression.getText()}}` + span.literal.text;
    });
    return text;
  }
  return null;
};

// ---------------------------------------------------------------------
// 1) role.service.ts — assignRoleToStaff
// ---------------------------------------------------------------------
// Binding real: o gate usa o CHECKER do TypeScript (não só forma local).
// O identificador enviado no body precisa RESOLVER para o símbolo do
// parâmetro `roleId` do método — assim `{ roleId: staffId }` (payload
// errado) é rejeitado, e shadowing local também.
const roleServicePath = resolve(FRONTEND, 'services/role.service.ts');
let roleService = null;
if (existsSync(roleServicePath)) {
  const program = ts.createProgram([roleServicePath], {
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(roleServicePath);
  if (source) roleService = { source, checker };
}
pass(!!roleService, 'frontend/src/services/role.service.ts existe');

if (roleService) {
  const { source, checker } = roleService;

  const method = findAll(
    source,
    (n) => ts.isMethodDeclaration(n) && isIdentifier(n.name, 'assignRoleToStaff')
  )[0];
  pass(!!method, 'role.service expõe o método assignRoleToStaff');

  if (method) {
    const calls = findAll(
      method,
      (n) =>
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === 'api'
    );
    const posts = calls.filter((c) => c.expression.name.text === 'post');
    const gets = calls.filter((c) => c.expression.name.text === 'get');

    pass(posts.length === 1, 'assignRoleToStaff faz exatamente 1 chamada api.post', `posts=${posts.length}`);
    pass(gets.length === 0, 'assignRoleToStaff NÃO faz GET (bug do data.data)', `gets=${gets.length}`);

    const post = posts[0];
    if (post) {
      const [urlArg, bodyArg] = post.arguments;

      // Binding: um identificador só vale se RESOLVER (checker) para o
      // parâmetro do método — forma local não prova vínculo de escopo.
      const methodParams = method.parameters ?? [];
      const paramSymbol = (name) => {
        const p = methodParams.find(
          (pp) => pp.name && ts.isIdentifier(pp.name) && pp.name.text === name
        );
        return p ? checker.getSymbolAtLocation(p.name) : null;
      };
      const boundToParam = (node, name) => {
        if (!node || !ts.isIdentifier(node)) return false;
        const ps = paramSymbol(name);
        if (!ps) return false;
        const s = checker.getSymbolAtLocation(node);
        return !!s && s === ps;
      };
      // Shorthand `{ roleId }`: `getSymbolAtLocation` no NOME devolve o
      // símbolo da PROPRIEDADE, não o da variável — o checker expõe o valor
      // pelo getShorthandAssignmentValueSymbol.
      const boundShorthandToParam = (prop, name) => {
        const ps = paramSymbol(name);
        if (!ps) return false;
        const s = checker.getShorthandAssignmentValueSymbol(prop);
        return !!s && s === ps;
      };

      // URL: template literal com /staff/ ... /assign-role e a expressão staffId
      const urlText = urlArg ? templateText(urlArg) : null;
      pass(
        !!urlText && urlText.includes('/staff/') && urlText.includes('/assign-role'),
        'assignRoleToStaff chama POST /staff/{id}/assign-role',
        urlText ?? 'n/a'
      );
      pass(
        !!urlText && urlText.includes('${staffId}'),
        'a URL do assign-role interpola o staffId',
        urlText ?? 'n/a'
      );
      const staffIdExpr =
        urlArg && ts.isTemplateExpression(urlArg)
          ? urlArg.templateSpans
              .map((s) => s.expression)
              .find((e) => ts.isIdentifier(e) && e.text === 'staffId')
          : null;
      pass(
        !!staffIdExpr && boundToParam(staffIdExpr, 'staffId'),
        'a URL do assign-role usa o PARÂMETRO staffId (não variável homônima)',
        staffIdExpr ? staffIdExpr.getText() : 'n/a'
      );

      // Body: object literal com a propriedade roleId, cujo valor RESOLVE
      // para o parâmetro `roleId` do método. Aceitar qualquer inicializador
      // deixava passar `{ roleId: staffId }` — payload errado com gate verde.
      const bodyOk =
        bodyArg &&
        ts.isObjectLiteralExpression(bodyArg) &&
        bodyArg.properties.some((p) => {
          if (ts.isShorthandPropertyAssignment(p)) {
            return isIdentifier(p.name, 'roleId') && boundShorthandToParam(p, 'roleId');
          }
          if (ts.isPropertyAssignment(p)) {
            return isIdentifier(p.name, 'roleId') && boundToParam(p.initializer, 'roleId');
          }
          return false;
        });
      pass(!!bodyOk, 'assignRoleToStaff envia { roleId } RESOLVIDO para o parâmetro roleId');

      // Não pode usar o endpoint de roles (aceita userId e ignora cargo inativo)
      const roleAssign = findAll(
        method,
        (n) => {
          const t = templateText(n);
          return !!t && t.includes('/roles/') && t.includes('/assign/');
        }
      );
      pass(roleAssign.length === 0, 'assignRoleToStaff NÃO usa POST /roles/:roleId/assign/:userId');

      // Não pode haver PUT/PATCH/DELETE no método
      const otherVerbs = calls.filter((c) => !['post', 'get'].includes(c.expression.name.text));
      pass(otherVerbs.length === 0, 'assignRoleToStaff só usa POST', `outros=${otherVerbs.length}`);
    }
  }
}

// ---------------------------------------------------------------------
// 2) StaffCard.tsx — permissão staff.create + gate pós-mount
// ---------------------------------------------------------------------
const staffCard = parse('components/staff/StaffCard.tsx');
pass(!!staffCard, 'frontend/src/components/staff/StaffCard.tsx existe');

if (staffCard) {
  const { source } = staffCard;

  const varDecl = (name) =>
    findAll(
      source,
      (n) =>
        ts.isVariableDeclaration(n) &&
        n.name &&
        ts.isIdentifier(n.name) &&
        n.name.text === name
    )[0];

  // canCreateStaff = usePermission('staff.create')
  const canCreate = varDecl('canCreateStaff');
  const createCall = canCreate?.initializer;
  pass(
    !!createCall &&
      ts.isCallExpression(createCall) &&
      ts.isIdentifier(createCall.expression) &&
      createCall.expression.text === 'usePermission' &&
      createCall.arguments.length === 1 &&
      isStringLiteral(createCall.arguments[0], 'staff.create'),
    'StaffCard: canCreateStaff = usePermission("staff.create")'
  );

  // canCompleteRegistration = mounted && canCreateStaff
  const canComplete = varDecl('canCompleteRegistration');
  const init = canComplete?.initializer;
  const isAnd =
    init && ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
  pass(
    !!isAnd &&
      isIdentifier(init.left, 'mounted') &&
      isIdentifier(init.right, 'canCreateStaff'),
    'StaffCard: canCompleteRegistration = mounted && canCreateStaff'
  );

  // mounted precisa virar TRUE dentro do useEffect — `setMounted(false)`
  // satisfazia a versão anterior (gate verde com botão nunca habilitado).
  const effectCalls = findAll(
    source,
    (n) =>
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'useEffect'
  );
  const isSetMountedTrue = (n) =>
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'setMounted' &&
    n.arguments.length === 1 &&
    n.arguments[0].kind === ts.SyntaxKind.TrueKeyword;
  const mountedInEffect = effectCalls.some((eff) => {
    const cb = eff.arguments[0];
    if (!cb) return false;
    return findAll(cb, isSetMountedTrue).length > 0;
  });
  pass(
    effectCalls.length > 0 && mountedInEffect,
    'StaffCard: permissão lida pós-mount (useEffect com setMounted(true))',
    `effects=${effectCalls.length}`
  );

  // O ternário gated precisa ser o que renderiza o link "Completar cadastro".
  // Um ternário decorativo com canCompleteRegistration passaria antes.
  const conditional = findAll(
    source,
    (n) =>
      ts.isConditionalExpression(n) &&
      isIdentifier(n.condition, 'canCompleteRegistration')
  );
  const gatedCompletion = conditional.some((c) => {
    const link = findAll(
      c.whenTrue,
      (n) => {
        const t = templateText(n);
        return !!t && t.includes('/staff/new?userId=') && t.includes('${staff.userId}');
      }
    );
    const label = findAll(
      c.whenTrue,
      (n) => ts.isJsxText(n) && n.text.includes('Completar cadastro')
    );
    return link.length > 0 && label.length > 0;
  });
  pass(
    gatedCompletion,
    'StaffCard: o ternário gated por canCompleteRegistration renderiza o link "Completar cadastro"',
    `ternarios=${conditional.length}`
  );

  // Item pendente: branch do ternário `!hasProfile` (whenTrue).
  // O link de detalhe /staff/${staff.id} é LEGÍTIMO no branch do item perfilado
  // (whenFalse) — o que não pode existir é link de detalhe no branch pendente.
  const pendingBranch = findAll(
    source,
    (n) =>
      ts.isConditionalExpression(n) &&
      ts.isPrefixUnaryExpression(n.condition) &&
      n.condition.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isIdentifier(n.condition.operand) &&
      n.condition.operand.text === 'hasProfile'
  )[0];

  pass(!!pendingBranch, 'StaffCard: branch do ternário !hasProfile encontrado');

  if (pendingBranch) {
    const pendingTemplates = findAll(pendingBranch.whenTrue, (n) => templateText(n) !== null);

    const newUserLink = pendingTemplates.find((t) => {
      const text = templateText(t);
      return text.includes('/staff/new?userId=') && text.includes('${staff.userId}');
    });
    pass(!!newUserLink, 'StaffCard: item pendente aponta para /staff/new?userId=${staff.userId}');

    const detailLink = pendingTemplates.find((t) => {
      const text = templateText(t);
      return text.includes('/staff/') && text.includes('${staff.id}');
    });
    pass(!detailLink, 'StaffCard: item pendente sem link de detalhe (/staff/${staff.id} seria 404)');

    // Sanidade: o item COM perfil continua tendo link de detalhe
    const profiledTemplates = findAll(pendingBranch.whenFalse, (n) => templateText(n) !== null);
    const profiledDetail = profiledTemplates.find((t) => {
      const text = templateText(t);
      return text.includes('/staff/') && text.includes('${staff.id}');
    });
    pass(!!profiledDetail, 'StaffCard: item perfilado mantém o link de detalhe /staff/${staff.id}');
  }
}

// ---------------------------------------------------------------------
// 3) StaffRoleAssignment.tsx — filtro hasProfile
// ---------------------------------------------------------------------
const roleAssignment = parse('components/roles/StaffRoleAssignment.tsx');
pass(!!roleAssignment, 'frontend/src/components/roles/StaffRoleAssignment.tsx existe');

if (roleAssignment) {
  const { source } = roleAssignment;

  // Tightened (fix pass 4): a comparação precisa estar DENTRO do callback
  // real do `.filter` — não pode estar em expressão morta, variável solta ou
  // comparação fora do filtro.
  const filterCalls = findAll(
    source,
    (n) =>
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === 'filter'
  );

  const filterUsesProfile = filterCalls.some((call) => {
    const callback = call.arguments[0];
    if (!callback) return false;
    const hits = findAll(
      callback,
      (n) =>
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        n.left.name.text === 'hasProfile' &&
        n.right.kind === ts.SyntaxKind.FalseKeyword
    );
    return hits.length > 0;
  });

  pass(
    filterCalls.length > 0 && filterUsesProfile,
    'StaffRoleAssignment: o callback do .filter usa hasProfile !== false (operador real)',
    `filters=${filterCalls.length}`
  );
}

// ---------------------------------------------------------------------
// 4) StaffForm.tsx — envia isAvailable
// ---------------------------------------------------------------------
const staffForm = parse('components/staff/StaffForm.tsx');
pass(!!staffForm, 'frontend/src/components/staff/StaffForm.tsx existe');

if (staffForm) {
  const { source } = staffForm;

  // Tightened (fix pass 4): `isAvailable` precisa estar no objeto PASSADO ao
  // onSubmit (o payload real do POST). Estar no estado do form ou em outro
  // objeto não basta — o dado se perderia no envio.
  const payloadObjects = findAll(
    source,
    (n) =>
      ts.isObjectLiteralExpression(n) &&
      n.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          isIdentifier(p.name, 'isAvailable') &&
          ts.isPropertyAccessExpression(p.initializer) &&
          p.initializer.expression.getText() === 'formData' &&
          p.initializer.name.text === 'isAvailable'
      )
  );

  const payloadIsSubmitted = payloadObjects.some((obj) =>
    findAll(
      source,
      (n) =>
        ts.isCallExpression(n) &&
        n.arguments.some((a) => a === obj) &&
        ((ts.isIdentifier(n.expression) && n.expression.text === 'onSubmit') ||
          (ts.isPropertyAccessExpression(n.expression) &&
            ['post', 'create', 'update'].includes(n.expression.name.text)))
    ).length > 0
  );

  pass(
    payloadObjects.length > 0 && payloadIsSubmitted,
    'StaffForm: envia isAvailable: formData.isAvailable dentro do payload do onSubmit',
    `payloads=${payloadObjects.length}`
  );

  // Lista branca de cargos proibida no dropdown (design 2026-11-19): o filtro
  // é presença de cargo, não nomes. ArrayLiteral dentro de setAvailableUsers =
  // regressão p/ whitelist.
  const setAvailableCalls = findAll(
    source,
    (n) =>
      ts.isCallExpression(n) &&
      n.expression.getText() === 'setAvailableUsers'
  );
  pass(setAvailableCalls.length > 0, 'StaffForm chama setAvailableUsers');
  let hasArrayLiteral = false;
  const walk = (node) => {
    if (ts.isArrayLiteralExpression(node)) { hasArrayLiteral = true; return; }
    ts.forEachChild(node, walk);
  };
  setAvailableCalls.forEach(walk);
  pass(!hasArrayLiteral, 'setAvailableUsers(...) não contém lista branca (ArrayLiteral)');
}

console.log(`\nFALHAS: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
