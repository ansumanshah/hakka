import probeUrl from './rspack-probe.txt'

console.log('hakka webpack probe app booted')

void fetch(probeUrl).then((response) => console.log('rspack probe fetch', response.status))
