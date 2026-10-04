import { StyleSheet } from 'react-native';
import colors from '../../assets/brand/colors.json';

// The same forest/cream tokens also drive installed icons and the web app shell.
export const theme = colors;
export const palettes = {
  sage: { background: '#CCEFDF', ink: '#235D49' }, peach: { background: '#FFDCC2', ink: '#804329' },
  butter: { background: '#FFEEAA', ink: '#725518' }, sky: { background: '#CDEBFF', ink: '#295578' },
  lilac: { background: '#E2D8FF', ink: '#58428A' }, rose: { background: '#FFD9E3', ink: '#8E3855' },
};
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  container: { width: '100%', maxWidth: 1160, alignSelf: 'center', paddingHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  heading: { fontSize: 32, fontWeight: '800', color: theme.ink, letterSpacing: -0.8 },
  title: { color: theme.ink, fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  body: { color: theme.muted, fontSize: 15, lineHeight: 22 },
  small: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: theme.surface, borderRadius: 22, padding: 20 },
  label: { color: theme.ink, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  field: { borderWidth: 1, borderColor: theme.line, borderRadius: 14, backgroundColor: theme.surface, color: theme.ink, paddingHorizontal: 15, paddingVertical: 13, fontSize: 16, minHeight: 50 },
  divider: { height: 1, backgroundColor: theme.line, marginVertical: 8 },
});
