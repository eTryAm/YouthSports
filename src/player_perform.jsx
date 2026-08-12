import "./player_perform.css";
import Charts from "./Charts";

function Player({ players, bowlers, matchStatus }) {
  return (
    <>
      <div className="inning">
        Kushinagar v/s Deoria
        <p>Inning: 1</p>
        <p>Status: {matchStatus.toUpperCase()}</p>
      </div>

      <h1>Scorecard</h1>

      <div className="main-container">
        {/* LEFT SIDE: TABLES */}
        <div className="left-section">
          <h3>Batting</h3>

          <table border="1">
            <thead>
              <tr>
                <th>Player</th>
                <th>Runs</th>
                <th>Balls</th>
                <th>Strike Rate</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, index) => (
                <tr key={index}>
                  <td>{p.name}</td>
                  <td>{p.runs}</td>
                  <td>{p.balls}</td>
                  <td>{p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(2) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Bowling</h3>

          <table border="1">
            <thead>
              <tr>
                <th>Name</th>
                <th>Overs</th>
                <th>Runs</th>
                <th>Economy</th>
              </tr>
            </thead>
            <tbody>
              {bowlers.map((b, index) => (
                <tr key={index}>
                  <td>{b.name}</td>
                  <td>{b.overs}</td>
                  <td>{b.runs}</td>
                  <td>{b.overs > 0 ? (b.runs / b.overs).toFixed(2) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RIGHT SIDE: CHARTS */}
        <div className="right-section">
          <Charts players={players} bowlers={bowlers} />
        </div>
      </div>
    </>
  );
}

export default Player;