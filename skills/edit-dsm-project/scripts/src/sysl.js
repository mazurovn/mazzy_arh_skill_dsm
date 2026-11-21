/* Each DSM object is an application. Calls target an inert endpoint so a static
   dependency is never interpreted as an inferred nested execution sequence. */
const Sysl = (() => {
  function symbol(id) {
    return 'App' + Array.from(id, c => /[a-z0-9]/i.test(c) ? c : '_'+c.codePointAt(0).toString(16)+'_').join('');
  }

  function write(model) {
    const calls = new Map(model.nodes.map(n => [n.id, []]));
    for (const e of model.edges) if (e.layer === 'flow') calls.get(e.from).push(e);
    const applications = model.nodes.map(n => {
      const lines = ['# '+JSON.stringify([n.id, n.name]), symbol(n.id)+':', '    Receive:', '        ...'];
      if (calls.get(n.id).length) {
        lines.push('    Dependencies:');
        for (const e of calls.get(n.id)) {
          lines.push('        # '+JSON.stringify(e.reason), '        '+symbol(e.to)+' <- Receive');
        }
      }
      return lines.join('\n');
    });
    return applications.join('\n\n')+'\n';
  }
  return {write};
})();
if (typeof module !== 'undefined') module.exports = Sysl;
