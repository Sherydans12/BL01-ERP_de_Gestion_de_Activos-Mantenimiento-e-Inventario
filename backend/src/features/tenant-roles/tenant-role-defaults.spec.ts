import { resolveApprovalPolicyForUser } from './tenant-role-defaults';

type TestPolicy = {
  level: number;
  id: string;
  allowedUsers: Array<{ userId: string }>;
};

describe('resolveApprovalPolicyForUser', () => {
  const userA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const policies: TestPolicy[] = [
    {
      level: 1,
      id: 'policy-l1',
      allowedUsers: [{ userId: userA }],
    },
    {
      level: 2,
      id: 'policy-l2',
      allowedUsers: [{ userId: userA }, { userId: userB }],
    },
    {
      level: 3,
      id: 'policy-l3',
      allowedUsers: [{ userId: userB }],
    },
  ];

  it('devuelve la primera política (menor level) donde el usuario está en allowedUsers', () => {
    const match = resolveApprovalPolicyForUser(policies, { id: userA });
    expect(match?.level).toBe(1);
    expect(match?.id).toBe('policy-l1');
  });

  it('devuelve el nivel más bajo aplicable cuando el usuario está en varios niveles', () => {
    const match = resolveApprovalPolicyForUser(policies, { id: userB });
    expect(match?.level).toBe(2);
    expect(match?.id).toBe('policy-l2');
  });

  it('devuelve undefined si el usuario no está en ningún nivel ACL', () => {
    const unknown = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    expect(
      resolveApprovalPolicyForUser(policies, { id: unknown }),
    ).toBeUndefined();
  });

  it('no hace match si allowedUsers está vacío', () => {
    const empty: TestPolicy[] = [{ level: 1, id: 'empty', allowedUsers: [] }];
    expect(resolveApprovalPolicyForUser(empty, { id: userA })).toBeUndefined();
  });

  it('respeta el orden del arreglo (debe venir ordenado por level asc desde el caller)', () => {
    const reversed: TestPolicy[] = [
      { level: 3, id: 'p3', allowedUsers: [{ userId: userA }] },
      { level: 1, id: 'p1', allowedUsers: [{ userId: userA }] },
    ];
    const match = resolveApprovalPolicyForUser(reversed, { id: userA });
    expect(match?.level).toBe(3);
  });
});
