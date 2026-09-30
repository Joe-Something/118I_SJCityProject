export function RoleSelector({ role, setRole }: { role: 'Applicant' | 'City Staff', setRole: (r: 'Applicant' | 'City Staff') => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid hsl(var(--border))', padding: '4px 10px', borderRadius: 999, background: 'hsl(var(--card))' }}>
      <span style={{ fontSize: 10, color: 'hsl(var(--muted-foreground))', fontWeight: 700, letterSpacing: '0.05em' }}>WORKSPACE VIEW</span>
      <select 
        value={role} 
        onChange={e => setRole(e.target.value as any)} 
        style={{ fontSize: 13, fontWeight: 700, border: 'none', outline: 'none', background: 'transparent', color: 'hsl(var(--primary))', cursor: 'pointer', paddingRight: 0 }}
        data-testid="select-prototype-role"
        aria-label="Select workspace view"
      >
        <option value="Applicant">Applicant</option>
        <option value="City Staff">City Staff</option>
      </select>
    </div>
  );
}