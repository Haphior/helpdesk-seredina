import * as snmp from 'net-snmp';

const SYS_DESCR_OID = '1.3.6.1.2.1.1.1.0';
const SYS_NAME_OID = '1.3.6.1.2.1.1.5.0';
const SNMP_TIMEOUT_MS = 500;
// The only community string worth trying in a v1, best-effort, agentless sweep --
// most managed switches/printers ship it as the default read-only community. Custom
// community strings are out of scope until there's a real config surface for them.
const COMMUNITY = 'public';

export interface SnmpFacts {
  sysDescr?: string;
  sysName?: string;
}

/** Resolves to null on any failure (no SNMP agent, wrong community, timeout, ...) -- never rejects. */
export function probeSnmp(ip: string): Promise<SnmpFacts | null> {
  return new Promise((resolve) => {
    const session = snmp.createSession(ip, COMMUNITY, {
      timeout: SNMP_TIMEOUT_MS,
      retries: 0,
      version: snmp.Version2c,
    });

    session.get([SYS_DESCR_OID, SYS_NAME_OID], (error, varbinds) => {
      session.close();

      if (error || !varbinds) return resolve(null);

      const facts: SnmpFacts = {};
      for (const vb of varbinds) {
        if (snmp.isVarbindError(vb) || vb.value == null) continue;
        if (vb.oid === SYS_DESCR_OID) facts.sysDescr = vb.value.toString();
        if (vb.oid === SYS_NAME_OID) facts.sysName = vb.value.toString();
      }
      resolve(facts.sysDescr || facts.sysName ? facts : null);
    });

    session.on('error', () => resolve(null));
  });
}
