import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { queryClient } from "./lib/queryClient";
import Design from "./pages/Design";
import EventScreen from "./pages/EventScreen";
import MainScreen from "./pages/MainScreen";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/" element={<MainScreen />} />
        <Route path="/event/:eventId" element={<EventScreen />} />
        <Route path="/design" element={<Design />} />
      </Routes>
    </QueryClientProvider>
  );
}

export default App;
