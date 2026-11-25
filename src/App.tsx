import { HashRouter, Route, Routes } from "react-router-dom";
import Home from "./screens/Home";
import Setup from "./screens/Setup";
import Game from "./screens/Game";
import Lists from "./screens/Lists";
import ListEditor from "./screens/ListEditor";
import Settings from "./screens/Settings";

// HashRouter: the Android back button walks the in-app history.
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/game" element={<Game />} />
        <Route path="/lists" element={<Lists />} />
        <Route path="/lists/:id" element={<ListEditor />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </HashRouter>
  );
}
