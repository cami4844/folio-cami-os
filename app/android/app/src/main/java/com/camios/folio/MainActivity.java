package com.camios.folio;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolioTorchPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
