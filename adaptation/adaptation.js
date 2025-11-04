let mode="none";
async function detectDeviceContext() {
    // Prüfe, ob WebXR verfügbar ist (VR- oder AR-fähig)
    if (navigator.xr) {
        try {
        const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
        if (vrSupported) return "HMD";
        } catch (e) {
        console.warn("XR detection error:", e);
        }
    }
    // Standardmäßig Laptop
    return "Laptop";
}

async function redirectToContextPage() {

    const context = await detectDeviceContext();
    console.log("Detected context:", context);
    
    switch (context) {
        case "HMD":
            if(mode=="Mathe"){
                window.location.href = "./vr_math.html";
            }
            else{
                window.location.href = "./vr_pop.html";
            }
                  // VR-Version
            break;
        case "Laptop":
            if(mode=="Mathe"){
                window.location.href = "./math.html";
            }
            else {
                window.location.href = "./puzzle_pop.html";
            }
              // Laptop-Version
            break;
        }
}
let math = document.getElementById("mathe")
let puzzle = document.getElementById("puzzle")
math.addEventListener("click", () => {
    mode ="Mathe";
    redirectToContextPage();
});
puzzle.addEventListener("click",() => {
    mode = "Puzzle";
    redirectToContextPage();
})

